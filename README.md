# dsh-nagi-skills

把 [Nagi Studio 的 skills](https://github.com/nagi-studio/skills) 打包成 DeepSeek Harness 插件。安装一次，四个 skill 注册到所有会话的 skill 目录，不需要往 `~/.agents/skills` 复制文件。

## 包含的 skill

| Skill | 上游分类 | 用途 | 用户可能这样说 |
|---|---|---|---|
| `grill` | pondering | 分轮追问计划或想法，直到重要未知暴露出来；分 5 档强度 | 拷打我、帮我想清楚、grill me、stress-test this |
| `architect` | rookie | 需求清楚后比较两三套技术方案，按维护成本排序并推荐一套 | 用什么技术做、怎么部署、which stack |
| `prove-it` | rookie | 要求 agent 用测试结果和截图交差；被纠正第二次就加一道会报错的检查 | prove it、又错了、清理没用的测试 |
| `de-slop` | rookie | 截图后对着清单给界面做减法，把用户纠正过的写进 `DESIGN.md` | 界面有 AI 味、一眼像 AI 做的 |

正文来自上游仓库的同名 `SKILL.md`，本插件只做 DSH 接入，不改写内容。每个 skill 背后的视频说明在上游 README 里。



## 已知限制

- 目录发现只认 `skills/<name>/SKILL.md` 一层，不支持嵌套分类。
- 不监听文件变化；改 description 后需要重载插件。
- 加载某个 skill 会把整篇说明放进上下文，没有分段加载。
- 只在 DSH 0.2.1-rc.5 上验证过；`engines.dsh` 要求 `>=0.2.1-rc.5`。
- 不提供额外的命令或界面；用户显式调用走 DSH 自带的 `/name` 机制。

## 来源与许可

- 上游仓库：[nagi-studio/skills](https://github.com/nagi-studio/skills)，MIT，Copyright (c) 2026 Nagi Studio。
- `grill` 的早期思路来自 Matt Pocock 的 grilling（MIT），其 LICENSE 保留在 `skills/grill/LICENSE`。
- `prove-it` 和 `de-slop` 的参考来源见上游 README 与 `THIRD_PARTY_NOTICES.md`。
- 本插件是社区适配，不属于 Nagi Studio 官方发布；上游仓库没有 DSH 插件。
