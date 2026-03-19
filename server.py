#!/usr/bin/env python3

import argparse
import json
import random
import socket
import threading
import time
import uuid
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
ROOMS = {}
ROOM_LOCK = threading.Lock()
SERVER_PORT = 8000
LAN_IP = "127.0.0.1"

PLAYER_MIN = 3
PLAYER_MAX = 3
CARD_ORDER = ["3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A", "2", "BJ", "RJ"]
RANK_WEIGHT = {rank: index + 3 for index, rank in enumerate(CARD_ORDER)}
SUITS = [
    ("spade", "♠", "black"),
    ("heart", "♥", "red"),
    ("club", "♣", "black"),
    ("diamond", "♦", "red"),
]


class ApiError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message


def now():
    return time.time()


def local_ip():
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        sock.connect(("8.8.8.8", 80))
        return sock.getsockname()[0]
    except OSError:
        try:
            return socket.gethostbyname(socket.gethostname())
        except OSError:
            return "127.0.0.1"
    finally:
        sock.close()


def sanitize_name(name):
    value = (name or "").strip()
    if not value:
        raise ApiError(HTTPStatus.BAD_REQUEST, "请输入昵称。")
    return value[:12]


def next_player(order, player_id):
    index = order.index(player_id)
    return order[(index + 1) % len(order)]


def rotated(sequence, start_value):
    start_index = sequence.index(start_value)
    return sequence[start_index:] + sequence[:start_index]


def touch(room):
    room["version"] += 1
    room["updated_at"] = now()


def room_phase(room):
    return room["game"]["phase"] if room["game"] else "waiting"


def create_room_id():
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    while True:
        room_id = "".join(random.choice(alphabet) for _ in range(4))
        if room_id not in ROOMS:
            return room_id


def create_player(name):
    return {
        "id": uuid.uuid4().hex[:8],
        "token": uuid.uuid4().hex,
        "name": sanitize_name(name),
        "joined_at": now(),
    }


def create_card(rank, suit_key, suit_icon, color, index):
    label = f"{suit_icon}{rank}" if suit_icon else ("小王" if rank == "BJ" else "大王")
    return {
        "id": f"{rank}-{suit_key or 'joker'}-{index}",
        "rank": rank,
        "suit": suit_key,
        "icon": suit_icon,
        "color": color,
        "value": RANK_WEIGHT[rank],
        "label": label,
    }


def create_deck():
    deck = []
    index = 0
    for suit_key, suit_icon, color in SUITS:
        for rank in CARD_ORDER[:13]:
            deck.append(create_card(rank, suit_key, suit_icon, color, index))
            index += 1
    deck.append(create_card("BJ", "", "", "black", index))
    deck.append(create_card("RJ", "", "", "red", index + 1))
    return deck


def sort_cards(cards):
    return sorted(cards, key=lambda card: (card["value"], card["label"]))


def classify_combo(cards):
    if not cards:
        return None

    sorted_cards = sort_cards(cards)
    counts = {}
    for card in sorted_cards:
        counts[card["value"]] = counts.get(card["value"], 0) + 1
    weights = sorted(counts.keys())
    count_values = sorted(counts.values())

    if len(sorted_cards) == 1:
        return {"type": "single", "main": sorted_cards[0]["value"], "length": 1, "label": "单张"}
    if len(sorted_cards) == 2 and is_rocket(weights):
        return {"type": "rocket", "main": 99, "length": 1, "label": "王炸"}
    if len(sorted_cards) == 2 and count_values[0] == 2:
        return {"type": "pair", "main": weights[0], "length": 1, "label": "对子"}
    if len(sorted_cards) == 3 and count_values[0] == 3:
        return {"type": "triple", "main": weights[0], "length": 1, "label": "三张"}
    if len(sorted_cards) == 4 and ",".join(str(item) for item in count_values) == "1,3":
        return {"type": "triple-single", "main": find_weight_by_count(counts, 3)[0], "length": 1, "label": "三带一"}
    if len(sorted_cards) == 4 and count_values[0] == 4:
        return {"type": "bomb", "main": weights[0], "length": 1, "label": "炸弹"}
    if len(sorted_cards) == 5 and ",".join(str(item) for item in count_values) == "2,3":
        return {"type": "triple-pair", "main": find_weight_by_count(counts, 3)[0], "length": 1, "label": "三带一对"}
    if is_straight(weights, counts, 1, 5):
        return {"type": "straight", "main": weights[0], "length": len(sorted_cards), "label": "顺子"}
    if is_straight(weights, counts, 2, 6):
        return {"type": "pair-straight", "main": weights[0], "length": len(sorted_cards) // 2, "label": "连对"}

    plane_pure = detect_plane(counts, len(sorted_cards), False)
    if plane_pure:
        return plane_pure
    plane_single = detect_plane(counts, len(sorted_cards), "single")
    if plane_single:
        return plane_single
    plane_pair = detect_plane(counts, len(sorted_cards), "pair")
    if plane_pair:
        return plane_pair
    four_two = detect_four_with_two(counts, len(sorted_cards))
    if four_two:
        return four_two
    return None


def is_rocket(weights):
    return len(weights) == 2 and RANK_WEIGHT["BJ"] in weights and RANK_WEIGHT["RJ"] in weights


def find_weight_by_count(counts, target):
    return sorted(weight for weight, count in counts.items() if count == target)


def is_straight(weights, counts, per_group, minimum_cards):
    total_cards = len(weights) * per_group
    if total_cards < minimum_cards:
        return False
    if any(weight >= RANK_WEIGHT["2"] for weight in weights):
        return False
    if any(count != per_group for count in counts.values()):
        return False
    return is_consecutive(weights)


def is_consecutive(weights):
    return all(weights[index] == weights[index - 1] + 1 for index in range(1, len(weights)))


def detect_plane(counts, total_cards, wing_type):
    triples = sorted(weight for weight, count in counts.items() if count >= 3 and weight < RANK_WEIGHT["2"])
    for start in range(len(triples)):
        for end in range(start + 1, len(triples)):
            sequence = triples[start : end + 1]
            if not is_consecutive(sequence):
                continue
            length = len(sequence)
            if wing_type is False:
                required = length * 3
            elif wing_type == "single":
                required = length * 4
            else:
                required = length * 5
            if required != total_cards:
                continue

            leftovers = dict(counts)
            for weight in sequence:
                leftovers[weight] -= 3
            non_zero = [(weight, count) for weight, count in leftovers.items() if count > 0]
            values = sorted(count for _, count in non_zero)
            if wing_type is False and not values:
                return {"type": "plane", "main": sequence[0], "length": length, "label": "飞机"}
            if wing_type == "single" and len(values) == length and all(count == 1 for count in values):
                if all(weight not in sequence for weight, _ in non_zero):
                    return {"type": "plane-single", "main": sequence[0], "length": length, "label": "飞机带单"}
            if wing_type == "pair" and len(values) == length and all(count == 2 for count in values):
                if all(weight not in sequence for weight, _ in non_zero):
                    return {"type": "plane-pair", "main": sequence[0], "length": length, "label": "飞机带对"}
    return None


def detect_four_with_two(counts, total_cards):
    four = find_weight_by_count(counts, 4)
    if not four:
        return None
    if total_cards == 6:
        return {"type": "four-two-single", "main": four[0], "length": 1, "label": "四带二"}
    if total_cards == 8:
        rest = [(weight, count) for weight, count in counts.items() if weight != four[0]]
        if len(rest) == 2 and all(count == 2 for _, count in rest):
            return {"type": "four-two-pair", "main": four[0], "length": 1, "label": "四带两对"}
    return None


def can_beat(current, previous):
    if not previous:
        return True
    if previous["type"] == "rocket":
        return False
    if current["type"] == "rocket":
        return True
    if current["type"] == "bomb" and previous["type"] != "bomb":
        return True
    if current["type"] != previous["type"]:
        return False
    if current["length"] != previous["length"]:
        return False
    return current["main"] > previous["main"]


def describe_cards(cards):
    return " ".join(card["label"] for card in sort_cards(cards))


def player_name(room, player_id):
    for player in room["players"]:
        if player["id"] == player_id:
            return player["name"]
    return "玩家"


def start_round(room, opening_message=None):
    if len(room["players"]) != PLAYER_MAX:
        raise ApiError(HTTPStatus.BAD_REQUEST, "满 3 人才能开始。")

    order = [player["id"] for player in room["players"]]
    deck = create_deck()
    random.shuffle(deck)
    hands = {
        order[0]: sort_cards(deck[:17]),
        order[1]: sort_cards(deck[17:34]),
        order[2]: sort_cards(deck[34:51]),
    }
    kitty = sort_cards(deck[51:])
    first_bidder = random.choice(order)
    bid_sequence = rotated(order, first_bidder)
    round_number = room.get("round_number", 0) + 1
    room["round_number"] = round_number

    logs = []
    if opening_message:
        logs.append(opening_message)
    logs.append(f"第 {round_number} 局开始，{player_name(room, first_bidder)} 先叫分。")

    room["game"] = {
        "phase": "bidding",
        "order": order,
        "turn": first_bidder,
        "hands": hands,
        "bids": {player_id: None for player_id in order},
        "highest_bid": 0,
        "highest_bidder": None,
        "landlord": None,
        "kitty": kitty,
        "last_play": None,
        "trick_leader": None,
        "pass_count": 0,
        "winner": None,
        "winner_side": None,
        "logs": logs,
        "bid_sequence": bid_sequence,
        "bid_turn_index": 0,
        "started_at": now(),
    }
    touch(room)


def finalize_bidding(room, landlord_id=None):
    game = room["game"]
    landlord = landlord_id or game["highest_bidder"]
    if not landlord:
        start_round(room, "三家都不叫，重新发牌。")
        return

    game["landlord"] = landlord
    game["phase"] = "playing"
    game["turn"] = landlord
    game["trick_leader"] = landlord
    game["pass_count"] = 0
    game["last_play"] = None
    game["hands"][landlord] = sort_cards(game["hands"][landlord] + game["kitty"])
    game["logs"].append(f"{player_name(room, landlord)} 成为地主，底牌加入手牌。")
    touch(room)


def handle_bid(room, player_id, bid):
    game = room["game"]
    if game["phase"] != "bidding":
        raise ApiError(HTTPStatus.BAD_REQUEST, "现在不是叫分阶段。")
    if game["turn"] != player_id:
        raise ApiError(HTTPStatus.CONFLICT, "还没轮到你叫分。")
    if bid not in (0, 1, 2, 3):
        raise ApiError(HTTPStatus.BAD_REQUEST, "叫分只能是 0 到 3。")

    game["bids"][player_id] = bid
    game["logs"].append(f"{player_name(room, player_id)} 叫分：{'不叫' if bid == 0 else f'{bid} 分'}")

    if bid > game["highest_bid"]:
        game["highest_bid"] = bid
        game["highest_bidder"] = player_id

    if bid == 3:
        finalize_bidding(room, player_id)
        return

    if game["bid_turn_index"] >= len(game["bid_sequence"]) - 1:
        finalize_bidding(room)
        return

    game["bid_turn_index"] += 1
    game["turn"] = game["bid_sequence"][game["bid_turn_index"]]
    touch(room)


def handle_pass(room, player_id):
    game = room["game"]
    if game["phase"] != "playing":
        raise ApiError(HTTPStatus.BAD_REQUEST, "现在不能不要。")
    if game["turn"] != player_id:
        raise ApiError(HTTPStatus.CONFLICT, "还没轮到你出牌。")
    if not game["last_play"]:
        raise ApiError(HTTPStatus.BAD_REQUEST, "当前轮到你起牌，不能不要。")
    if game["trick_leader"] == player_id:
        raise ApiError(HTTPStatus.BAD_REQUEST, "你是本轮起牌人，不能不要。")

    game["logs"].append(f"{player_name(room, player_id)} 选择不要。")
    game["pass_count"] += 1
    if game["pass_count"] >= 2:
        game["turn"] = game["trick_leader"]
        game["last_play"] = None
        game["pass_count"] = 0
        game["logs"].append("两家连续不要，新一轮由上手继续出牌。")
    else:
        game["turn"] = next_player(game["order"], player_id)
    touch(room)


def handle_play(room, player_id, card_ids):
    game = room["game"]
    if game["phase"] != "playing":
        raise ApiError(HTTPStatus.BAD_REQUEST, "现在不能出牌。")
    if game["turn"] != player_id:
        raise ApiError(HTTPStatus.CONFLICT, "还没轮到你出牌。")
    if not isinstance(card_ids, list) or not card_ids:
        raise ApiError(HTTPStatus.BAD_REQUEST, "请先选择要出的牌。")

    hand = game["hands"][player_id]
    cards = []
    for card_id in card_ids:
        matched = next((card for card in hand if card["id"] == card_id), None)
        if not matched:
            raise ApiError(HTTPStatus.BAD_REQUEST, "你选择了不存在的手牌。")
        cards.append(matched)

    combo = classify_combo(cards)
    if not combo:
        raise ApiError(HTTPStatus.BAD_REQUEST, "当前选择不是合法牌型。")

    if game["last_play"] and game["trick_leader"] != player_id:
        if not can_beat(combo, game["last_play"]["combo"]):
            raise ApiError(HTTPStatus.BAD_REQUEST, "当前牌压不过桌面上的牌。")

    remaining = [card for card in hand if card["id"] not in set(card_ids)]
    game["hands"][player_id] = sort_cards(remaining)
    game["last_play"] = {
        "player_id": player_id,
        "combo": combo,
        "cards": sort_cards(cards),
    }
    game["trick_leader"] = player_id
    game["pass_count"] = 0
    game["logs"].append(f"{player_name(room, player_id)} 出牌：{describe_cards(cards)}（{combo['label']}）")

    if not remaining:
        game["phase"] = "finished"
        game["winner"] = player_id
        game["winner_side"] = "地主" if player_id == game["landlord"] else "农民"
        game["logs"].append(f"{player_name(room, player_id)} 率先出完手牌，{game['winner_side']}胜利。")
    else:
        game["turn"] = next_player(game["order"], player_id)
    touch(room)


def create_room(name):
    player = create_player(name)
    room_id = create_room_id()
    room = {
        "id": room_id,
        "host_id": player["id"],
        "players": [player],
        "game": None,
        "created_at": now(),
        "updated_at": now(),
        "version": 1,
        "round_number": 0,
    }
    ROOMS[room_id] = room
    return room, player


def join_room(room, name):
    if room_phase(room) != "waiting":
        raise ApiError(HTTPStatus.CONFLICT, "对局已经开始，不能再加入。")
    if len(room["players"]) >= PLAYER_MAX:
        raise ApiError(HTTPStatus.CONFLICT, "房间已经满了。")
    player = create_player(name)
    room["players"].append(player)
    touch(room)
    return player


def get_room(room_id):
    room = ROOMS.get(room_id.upper())
    if not room:
        raise ApiError(HTTPStatus.NOT_FOUND, "房间不存在。")
    return room


def get_player(room, player_id, token):
    player = next((item for item in room["players"] if item["id"] == player_id), None)
    if not player or player["token"] != token:
        raise ApiError(HTTPStatus.UNAUTHORIZED, "房间身份已失效，请重新加入。")
    return player


def build_share_url(room_id):
    return f"http://{LAN_IP}:{SERVER_PORT}/room.html?room={room_id}"


def build_room_summary(room):
    return {
        "roomId": room["id"],
        "phase": room_phase(room),
        "shareUrl": build_share_url(room["id"]),
        "playerCount": len(room["players"]),
        "capacity": PLAYER_MAX,
        "players": [{"id": player["id"], "name": player["name"]} for player in room["players"]],
        "canJoin": room_phase(room) == "waiting" and len(room["players"]) < PLAYER_MAX,
    }


def build_state(room, viewer):
    game = room["game"]
    order = [player["id"] for player in room["players"]]
    players = []
    for player in room["players"]:
        hand = game["hands"].get(player["id"], []) if game else []
        players.append(
            {
                "id": player["id"],
                "name": player["name"],
                "isHost": player["id"] == room["host_id"],
                "isSelf": player["id"] == viewer["id"],
                "isLandlord": bool(game and game["landlord"] == player["id"]),
                "handCount": len(hand),
                "bid": game["bids"].get(player["id"]) if game else None,
            }
        )

    last_play = None
    if game and game["last_play"]:
        last_play = {
            "playerId": game["last_play"]["player_id"],
            "cards": game["last_play"]["cards"],
            "comboLabel": game["last_play"]["combo"]["label"],
        }

    return {
        "roomId": room["id"],
        "phase": room_phase(room),
        "version": room["version"],
        "shareUrl": build_share_url(room["id"]),
        "playerId": viewer["id"],
        "playerName": viewer["name"],
        "hostPlayerId": room["host_id"],
        "players": players,
        "order": order,
        "myHand": game["hands"].get(viewer["id"], []) if game else [],
        "turnPlayerId": game["turn"] if game else None,
        "highestBid": game["highest_bid"] if game else 0,
        "landlordPlayerId": game["landlord"] if game else None,
        "kitty": game["kitty"] if game and game["landlord"] else [],
        "lastPlay": last_play,
        "winnerPlayerId": game["winner"] if game else None,
        "winnerSide": game["winner_side"] if game else None,
        "logs": game["logs"][-16:] if game else [],
        "canStart": viewer["id"] == room["host_id"] and room_phase(room) == "waiting" and len(room["players"]) == PLAYER_MAX,
        "canRestart": viewer["id"] == room["host_id"] and bool(game and game["phase"] == "finished"),
        "canJoin": room_phase(room) == "waiting" and len(room["players"]) < PLAYER_MAX,
        "startedAt": game["started_at"] if game else None,
        "seatIndex": order.index(viewer["id"]) if viewer["id"] in order else 0,
    }


def read_json(handler):
    content_length = int(handler.headers.get("Content-Length", "0"))
    raw = handler.rfile.read(content_length) if content_length else b"{}"
    try:
        return json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError as error:
        raise ApiError(HTTPStatus.BAD_REQUEST, f"请求 JSON 格式错误：{error.msg}")


class DdzHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.startswith("/api/"):
            self.handle_api_get()
            return
        if self.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/"):
            self.handle_api_post()
            return
        self.send_error(HTTPStatus.NOT_FOUND)

    def log_message(self, format, *args):
        super().log_message(format, *args)

    def handle_api_get(self):
        try:
            parsed = urlparse(self.path)
            if parsed.path == "/api/server-info":
                self.write_json(
                    {
                        "port": SERVER_PORT,
                        "lanIp": LAN_IP,
                        "lanOrigin": f"http://{LAN_IP}:{SERVER_PORT}",
                    }
                )
                return

            if parsed.path.startswith("/api/rooms/") and parsed.path.endswith("/summary"):
                room_id = parsed.path.split("/")[3]
                with ROOM_LOCK:
                    room = get_room(room_id)
                    payload = build_room_summary(room)
                self.write_json(payload)
                return

            if parsed.path.startswith("/api/rooms/") and parsed.path.endswith("/state"):
                room_id = parsed.path.split("/")[3]
                query = parse_qs(parsed.query)
                player_id = query.get("playerId", [""])[0]
                token = query.get("token", [""])[0]
                with ROOM_LOCK:
                    room = get_room(room_id)
                    player = get_player(room, player_id, token)
                    payload = build_state(room, player)
                self.write_json(payload)
                return

            raise ApiError(HTTPStatus.NOT_FOUND, "接口不存在。")
        except ApiError as error:
            self.write_json({"error": error.message}, status=error.status)

    def handle_api_post(self):
        try:
            parsed = urlparse(self.path)
            payload = read_json(self)

            if parsed.path == "/api/rooms":
                with ROOM_LOCK:
                    room, player = create_room(payload.get("name"))
                    data = {
                        "roomId": room["id"],
                        "playerId": player["id"],
                        "token": player["token"],
                        "playerName": player["name"],
                        "shareUrl": build_share_url(room["id"]),
                    }
                self.write_json(data, status=HTTPStatus.CREATED)
                return

            if parsed.path.startswith("/api/rooms/") and parsed.path.endswith("/join"):
                room_id = parsed.path.split("/")[3]
                with ROOM_LOCK:
                    room = get_room(room_id)
                    player = join_room(room, payload.get("name"))
                    data = {
                        "roomId": room["id"],
                        "playerId": player["id"],
                        "token": player["token"],
                        "playerName": player["name"],
                    }
                self.write_json(data, status=HTTPStatus.CREATED)
                return

            if parsed.path.startswith("/api/rooms/") and parsed.path.endswith("/start"):
                room_id = parsed.path.split("/")[3]
                with ROOM_LOCK:
                    room = get_room(room_id)
                    player = get_player(room, payload.get("playerId"), payload.get("token"))
                    if player["id"] != room["host_id"]:
                        raise ApiError(HTTPStatus.FORBIDDEN, "只有房主可以开局。")
                    if room_phase(room) != "waiting":
                        raise ApiError(HTTPStatus.CONFLICT, "当前房间已经开始了。")
                    start_round(room)
                    data = build_state(room, player)
                self.write_json(data)
                return

            if parsed.path.startswith("/api/rooms/") and parsed.path.endswith("/action"):
                room_id = parsed.path.split("/")[3]
                with ROOM_LOCK:
                    room = get_room(room_id)
                    player = get_player(room, payload.get("playerId"), payload.get("token"))
                    if not room["game"]:
                        raise ApiError(HTTPStatus.CONFLICT, "游戏还没有开始。")
                    kind = payload.get("kind")
                    if kind == "bid":
                        handle_bid(room, player["id"], int(payload.get("bid", -1)))
                    elif kind == "play":
                        handle_play(room, player["id"], payload.get("cardIds", []))
                    elif kind == "pass":
                        handle_pass(room, player["id"])
                    elif kind == "restart":
                        if player["id"] != room["host_id"]:
                            raise ApiError(HTTPStatus.FORBIDDEN, "只有房主可以重开。")
                        if room["game"]["phase"] != "finished":
                            raise ApiError(HTTPStatus.CONFLICT, "当前对局还没有结束。")
                        start_round(room, "房主开始了新一局。")
                    else:
                        raise ApiError(HTTPStatus.BAD_REQUEST, "不支持的动作。")
                    data = build_state(room, player)
                self.write_json(data)
                return

            raise ApiError(HTTPStatus.NOT_FOUND, "接口不存在。")
        except ApiError as error:
            self.write_json({"error": error.message}, status=error.status)

    def write_json(self, payload, status=HTTPStatus.OK):
        content = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.end_headers()
        self.wfile.write(content)


def main():
    global SERVER_PORT, LAN_IP

    parser = argparse.ArgumentParser(description="局域网斗地主房间服务器")
    parser.add_argument("--port", type=int, default=8000, help="监听端口，默认 8000")
    args = parser.parse_args()

    SERVER_PORT = args.port
    LAN_IP = local_ip()

    server = ThreadingHTTPServer(("0.0.0.0", SERVER_PORT), DdzHandler)
    print(f"本机访问: http://127.0.0.1:{SERVER_PORT}")
    print(f"局域网访问: http://{LAN_IP}:{SERVER_PORT}")
    print("按 Ctrl+C 停止服务器")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务器已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
