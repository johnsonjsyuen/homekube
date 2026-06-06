#!/usr/bin/env python3
"""Test connectivity to KVRocks using the redis-py client (KVRocks is Redis-compatible)."""

import redis
import sys

HOST = "kvrocks.default.svc.cluster.local"
PORT = 6666

def test_kvrocks():
    print(f"Connecting to KVRocks at {HOST}:{PORT}...")
    # KVRocks does not support RESP3 (the HELLO command), so force RESP2
    r = redis.Redis(host=HOST, port=PORT, decode_responses=True, protocol=2)

    # Basic ping
    assert r.ping(), "PING failed"
    print("PING: OK")

    # String set/get
    r.set("test:greeting", "hello from python")
    val = r.get("test:greeting")
    assert val == "hello from python", f"Expected 'hello from python', got {val!r}"
    print(f"SET/GET: OK ({val!r})")

    # Integer increment
    r.set("test:counter", 0)
    r.incr("test:counter")
    r.incr("test:counter")
    count = int(r.get("test:counter"))
    assert count == 2, f"Expected 2, got {count}"
    print(f"INCR: OK (counter={count})")

    # List push/pop
    r.delete("test:list")
    r.rpush("test:list", "a", "b", "c")
    items = r.lrange("test:list", 0, -1)
    assert items == ["a", "b", "c"], f"Expected ['a','b','c'], got {items}"
    print(f"LIST: OK ({items})")

    # Hash
    r.hset("test:hash", mapping={"field1": "value1", "field2": "value2"})
    h = r.hgetall("test:hash")
    assert h == {"field1": "value1", "field2": "value2"}, f"Unexpected hash: {h}"
    print(f"HASH: OK ({h})")

    # Cleanup
    r.delete("test:greeting", "test:counter", "test:list", "test:hash")
    print("\nAll tests passed!")

if __name__ == "__main__":
    try:
        test_kvrocks()
    except Exception as e:
        print(f"FAILED: {e}", file=sys.stderr)
        sys.exit(1)
