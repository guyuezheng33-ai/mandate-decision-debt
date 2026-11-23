.PHONY: check test eval bench

# 一条命令跑完整闸门：构建 UI、manifest、verify、bench、eval、incremental、submission。
check:
	npm run check

test:
	npm test

eval:
	npm run eval && npm run eval:incremental

bench:
	npm run bench
