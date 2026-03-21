#!/usr/bin/env python3

import json
import os
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent


def pick_free_port():
    sock = socket.socket()
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()
    return port


def request(base, method, path, data=None):
    body = None if data is None else json.dumps(data).encode("utf-8")
    headers = {"Content-Type": "application/json"} if data is not None else {}
    req = urllib.request.Request(f"{base}{path}", data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=5) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8")
        return error.code, json.loads(raw) if raw else {}


def wait_for_server(port):
    base = f"http://127.0.0.1:{port}"
    deadline = time.time() + 8
    last_error = None
    while time.time() < deadline:
        try:
            status, _ = request(base, "GET", "/api/server-info")
            if status == 200:
                return base
        except Exception as error:  # pragma: no cover - best-effort bootstrap wait
            last_error = error
        time.sleep(0.15)
    raise RuntimeError(f"服务器未能在预期时间内启动: {last_error}")


def assert_true(condition, message):
    if not condition:
        raise AssertionError(message)


def find_cards(labels):
    import server

    deck = server.create_deck()
    by_label = {}
    for card in deck:
        by_label.setdefault(card["label"], []).append(card)
    return [by_label[label].pop() for label in labels]


def run_rule_checks():
    import server

    rocket = server.classify_combo(find_cards(["小王", "大王"]))
    assert_true(rocket and rocket["type"] == "rocket", "王炸识别失败")

    straight = server.classify_combo(find_cards(["♠10", "♥J", "♣Q", "♦K", "♠A"]))
    assert_true(straight and straight["type"] == "straight", "顺子识别失败")

    invalid = server.classify_combo(find_cards(["♠10", "♥J", "♣Q", "♦K", "♠2"]))
    assert_true(invalid is None, "包含 2 的顺子被错误识别")

    plane_single = server.classify_combo(find_cards(["♠3", "♥3", "♣3", "♠4", "♥4", "♣4", "♠6", "♥7"]))
    assert_true(plane_single and plane_single["type"] == "plane-single", "飞机带单识别失败")

    four_two_pair = server.classify_combo(find_cards(["♠5", "♥5", "♣5", "♦5", "♠6", "♥6", "♠7", "♥7"]))
    assert_true(four_two_pair and four_two_pair["type"] == "four-two-pair", "四带两对识别失败")

    bomb = server.classify_combo(find_cards(["♠9", "♥9", "♣9", "♦9"]))
    pair = server.classify_combo(find_cards(["♠J", "♥J"]))
    assert_true(server.can_beat(bomb, pair), "炸弹压普通牌失败")
    assert_true(not server.can_beat(pair, bomb), "普通牌错误压过炸弹")


def run_cleanup_unit_check():
    import server

    current = server.now()
    server.ROOMS.clear()
    server.ROOMS["WAIT"] = {
        "id": "WAIT",
        "host_id": "h1",
        "players": [{"id": "h1", "name": "房主"}],
        "game": None,
        "created_at": current - server.WAITING_ROOM_TTL - 5,
        "updated_at": current - server.WAITING_ROOM_TTL - 5,
        "version": 1,
        "round_number": 0,
    }
    server.ROOMS["PLAY"] = {
        "id": "PLAY",
        "host_id": "h2",
        "players": [{"id": "h2", "name": "房主"}],
        "game": {"phase": "playing"},
        "created_at": current,
        "updated_at": current,
        "version": 1,
        "round_number": 0,
    }
    server.cleanup_rooms()
    assert_true("WAIT" not in server.ROOMS, "等待中的过期房间没有被清理")
    assert_true("PLAY" in server.ROOMS, "活动房间被错误清理")
    server.ROOMS.clear()


def run_api_checks(base):
    status, host = request(base, "POST", "/api/rooms", {"name": "房主A"})
    assert_true(status == 201, "创建房间失败")
    room_id = host["roomId"]

    status, lobby = request(base, "GET", "/api/rooms/public")
    assert_true(status == 200, "大厅列表失败")
    assert_true(any(item["roomId"] == room_id for item in lobby["rooms"]), "大厅里没有新房间")

    status, player_b = request(base, "POST", f"/api/rooms/{room_id}/join", {"name": "玩家B"})
    assert_true(status == 201, "第二位玩家加入失败")
    status, player_c = request(base, "POST", f"/api/rooms/{room_id}/join", {"name": "玩家C"})
    assert_true(status == 201, "第三位玩家加入失败")

    status, forbidden_start = request(
        base,
        "POST",
        f"/api/rooms/{room_id}/start",
        {"playerId": player_b["playerId"], "token": player_b["token"]},
    )
    assert_true(status == 403 and "房主" in forbidden_start["error"], "非房主开局没有被拦住")

    status, invalid_state = request(
        base,
        "POST",
        f"/api/rooms/{room_id}/state",
        {"playerId": host["playerId"], "token": "bad-token"},
    )
    assert_true(status == 401 and "身份已失效" in invalid_state["error"], "错误 token 没有被拦住")

    status, state = request(
        base,
        "POST",
        f"/api/rooms/{room_id}/start",
        {"playerId": host["playerId"], "token": host["token"]},
    )
    assert_true(status == 200 and state["phase"] == "bidding", "开局后没有进入 bidding")

    status, post_state = request(
        base,
        "POST",
        f"/api/rooms/{room_id}/state",
        {"playerId": host["playerId"], "token": host["token"]},
    )
    assert_true(status == 200 and post_state["roomId"] == room_id, "POST /state 失败")

    status, _ = request(
        base,
        "GET",
        f"/api/rooms/{room_id}/state?playerId={host['playerId']}&token={host['token']}",
    )
    assert_true(status == 404, "旧的 GET /state 仍然可用，token 还会出现在日志里")

    players = {host["playerId"]: host, player_b["playerId"]: player_b, player_c["playerId"]: player_c}
    turn_player = players[state["turnPlayerId"]]
    status, invalid_bid = request(
        base,
        "POST",
        f"/api/rooms/{room_id}/action",
        {
            "playerId": turn_player["playerId"],
            "token": turn_player["token"],
            "kind": "bid",
            "bid": "abc",
        },
    )
    assert_true(status == 400 and "叫分" in invalid_bid["error"], "非法叫分没有被拦住")

    status, play_state = request(
        base,
        "POST",
        f"/api/rooms/{room_id}/action",
        {
            "playerId": turn_player["playerId"],
            "token": turn_player["token"],
            "kind": "bid",
            "bid": 3,
        },
    )
    assert_true(status == 200 and play_state["phase"] == "playing", "3 分抢地主后没有进入出牌阶段")

    landlord = players[play_state["landlordPlayerId"]]
    status, landlord_state = request(
        base,
        "POST",
        f"/api/rooms/{room_id}/state",
        {"playerId": landlord["playerId"], "token": landlord["token"]},
    )
    assert_true(status == 200 and landlord_state["myHand"], "地主状态获取失败")
    first_card_id = landlord_state["myHand"][0]["id"]
    status, duplicate_play = request(
        base,
        "POST",
        f"/api/rooms/{room_id}/action",
        {
            "playerId": landlord["playerId"],
            "token": landlord["token"],
            "kind": "play",
            "cardIds": [first_card_id, first_card_id],
        },
    )
    assert_true(status == 400 and "重复" in duplicate_play["error"], "重复牌作弊请求没有被拦住")

    status, join_after_start = request(base, "POST", f"/api/rooms/{room_id}/join", {"name": "路人D"})
    assert_true(status == 409 and "不能再加入" in join_after_start["error"], "开局后仍然能加入房间")


def main():
    run_cleanup_unit_check()
    run_rule_checks()

    port = pick_free_port()
    process = subprocess.Popen(
        [sys.executable, "server.py", "--port", str(port)],
        cwd=ROOT,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        env={**os.environ, "PYTHONUNBUFFERED": "1"},
    )

    try:
        base = wait_for_server(port)
        run_api_checks(base)
    finally:
        process.terminate()
        try:
            process.wait(timeout=3)
        except subprocess.TimeoutExpired:
            process.kill()
        output = process.stdout.read() if process.stdout else ""
        if output.strip():
            print(output.strip())

    print("selftest passed")


if __name__ == "__main__":
    main()
