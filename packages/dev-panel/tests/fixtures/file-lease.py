"""给几个文件挂 Linux 写租约（fcntl F_SETLEASE F_WRLCK），当作真实的文件屏障：别的进程打开这些文件时，
open() 在内核里挂住，直到这里放掉租约（或过了 /proc/sys/fs/lease-break-time，默认 45 秒）。stat 不受影响。

用法：python3 file-lease.py <文件>...；挂好后打印一行 held。之后从标准输入一行一条命令，每条回一行：
- state：JSON 数组，每个文件是 "held"（没人打开过）、"breaking"（有人在打开，被挂住了）或 "released"；
- release <序号>：放掉这个文件的租约，挂住的 open() 随即返回；回 ok；
- reacquire <序号>：重新挂上写租约。别人还开着这个文件时内核回 EAGAIN，就隔 10 毫秒再试，最多 20 秒；
  回 ok 说明别人已经把文件关了，回 timeout 说明一直没关。
标准输入关闭时退出，租约随文件描述符一起放掉。
"""
import errno
import fcntl
import json
import os
import signal
import sys
import time

# 有人打开文件时内核给租约持有者发 SIGIO（默认动作是结束进程）；这里改看 F_GETLEASE，不靠信号。
signal.signal(signal.SIGIO, signal.SIG_IGN)

fds = []
released = []
for path in sys.argv[1:]:
    fd = os.open(path, os.O_RDONLY)
    fcntl.fcntl(fd, fcntl.F_SETLEASE, fcntl.F_WRLCK)
    fds.append(fd)
    released.append(False)
print("held", flush=True)


def state(index):
    if released[index]:
        return "released"
    # 租约在被打破的途中时，F_GETLEASE 回的是要降到的类型（读打开降到 F_RDLCK，写打开降到 F_UNLCK）。
    return "held" if fcntl.fcntl(fds[index], fcntl.F_GETLEASE) == fcntl.F_WRLCK else "breaking"


def reacquire(index):
    deadline = time.monotonic() + 20
    while time.monotonic() < deadline:
        try:
            fcntl.fcntl(fds[index], fcntl.F_SETLEASE, fcntl.F_WRLCK)
            released[index] = False
            return "ok"
        except OSError as error:
            if error.errno != errno.EAGAIN:
                raise
            time.sleep(0.01)
    return "timeout"


for line in sys.stdin:
    command, _, argument = line.strip().partition(" ")
    if command == "state":
        print(json.dumps([state(index) for index in range(len(fds))]), flush=True)
    elif command == "release":
        index = int(argument)
        fcntl.fcntl(fds[index], fcntl.F_SETLEASE, fcntl.F_UNLCK)
        released[index] = True
        print("ok", flush=True)
    elif command == "reacquire":
        print(reacquire(int(argument)), flush=True)
    else:
        raise SystemExit(f"不认识的命令：{line!r}")
