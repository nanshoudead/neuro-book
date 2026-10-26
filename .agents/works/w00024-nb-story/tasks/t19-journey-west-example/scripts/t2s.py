import sys, opencc
src, dst = sys.argv[1], sys.argv[2]
open(dst, "w", encoding="utf-8").write(opencc.OpenCC("t2s").convert(open(src, encoding="utf-8").read()))
