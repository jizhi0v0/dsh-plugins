# Claude 记忆

让 DSH 读取本机 **Claude Code 的记忆**：在 DSH 会话里直接列出、搜索、读取 Claude Code 的 auto memory、用户级 `CLAUDE.md` 与 `rules/*.md`。只读——不写入、不联网。

![插件图标](./icon.svg)

## 功能

模型可用的三个只读工具：

| 工具 | 作用 |
|---|---|
| `claude_memory_list` | 按修改时间从新到旧列出记忆条目（时间、类型、路径、描述）；`project: "all"` 可看全部项目，默认只看当前会话所在项目。 |
| `claude_memory_search` | 对记忆全文做大小写不敏感的子串搜索，按文件新旧返回命中行与行号。 |
| `claude_memory_read` | 读取单个记忆文件（带行号，`offset`/`limit` 分页），路径必须落在 Claude 配置目录内。 |

## 记忆在哪

| 来源 | 位置 |
|---|---|
| 项目 auto memory | `~/.claude/projects/<project>/memory/`（`MEMORY.md` 索引 + 每个记忆一个 `.md`） |
| 用户级指令 | `~/.claude/CLAUDE.md` |
| 用户级规则 | `~/.claude/rules/**/*.md` |

设置 `CLAUDE_CONFIG_DIR` 可整体挪走 `~/.claude`，插件会跟随。
> 范围说明：项目级 `CLAUDE.md`/`AGENTS.md` 不在扫描范围——DSH 自带的 `dsh-agent-instructions` 会在每个会话自动加载它们。本插件聚焦 Claude Code 特有的 auto memory 与用户级文件。


`<project>` 的判定与 Claude Code 一致：会话工作目录所在 **git 仓库根目录** 的路径，所有非字母数字字符替换为 `-`；worktree（`.git` 文件指向 `<主仓库>/.git/worktrees/<name>`）归并到主仓库，因此和工作树、子目录共享同一份记忆；不在 git 仓库时用工作目录本身。解析时先试仓库根、再试目录本身，取第一个已存在 `memory/` 的。

## 安装

### 通过 GitHub 直接安装（推荐）

DSH → **Plugins** → **Add plugin**，粘贴：

```text
https://github.com/jizhi0v0/dsh-plugins.git#path:/packages/claude-memory
```

需要固定版本时，用 tag + path（格式如下，先给仓库打对应 tag）：

```text
https://github.com/jizhi0v0/dsh-plugins.git#v0.1.4&path:/packages/claude-memory
```

### 本地路径安装（开发时）

```text
/Users/bobby/Developer/github/dsh-plugins/packages/claude-memory
```

### CLI

```sh
dsh plugin --profile desktop add github:jizhi0v0/dsh-plugins#path:/packages/claude-memory
```

安装后可用 `dsh --profile <name> --dump-config` 确认组合里出现 `id: claude-memory` 行。

## 使用

装好后无须任何配置。在 DSH 里直接问，例如：

- 「看看我在 Claude 里记过哪些和发版有关的规则」→ 模型调用 `claude_memory_search { query: "发版" }`
- 「列出这个项目 Claude 的记忆」→ `claude_memory_list`（当前项目）
- 「其他项目都记了什么」→ `claude_memory_list { project: "all" }`
- 「把 deploy-notes 那条完整读出来」→ `claude_memory_read { file: "projects/<project>/memory/deploy-notes.md" }`

## 数据与安全

- **只读**：不写任何文件、不发任何网络请求。
- 读取路径被限制在 Claude 配置目录内（`claude_memory_read` 会拒绝 `..` 与目录外绝对路径）。
- 扫描跳过大于 2 MB 的文件；单次读取输出上限 64 KB，超出以分页 footer 提示。
- `claude_memory_list` / `claude_memory_search` 输出有 limit（默认 30 / 25），避免一次灌爆上下文。

## 工作原理

Host 半注册三个面向模型的工具（`ctx.tools.register`），无 Client 半、无界面。工具每次执行时：

1. 用 `workingDirectory` 服务（或会话 header 的 `cwd`）取会话目录；
2. 解析 `<project>` 并定位 `memory/` 目录与用户级文件；
3. 扫描 `.md`，解析 Claude Code 写的轻量 frontmatter（`name`/`description`/`metadata.type`/`modified`，缺失时回退文件名、首行与 mtime）；
4. 返回排序后的纯文本。

## 开发与验证

```bash
# 语法检查（仓库根目录）
npm run check

# 单元测试（仓库根目录）
npm test
```

测试覆盖：工具注册面（三个工具名、参数 schema 属于 DSH 受支持子集、`output.render`）、`projectSlug`、git 根 / worktree 解析、`resolveMemoryProject` 回退、frontmatter 解析、三个工具的真实读写行为（伪造 `~/.claude` 树：列表排序、全项目列举、子串搜索、大小写不敏感、行号、分页、路径越界拒绝、参数校验）。

### 当前验证情况（2026-10-30）

- ✅ 仓库测试：`npm run check`、`npm test` 通过；本插件新增 16 个测试（整套 33 个，含既有 deepseek-balance）。
- ✅ 真实 DSH 端到端（本机 DSH NEXT 2.0.21-next，dsh 0.2.1-rc.4）：`--from-default-profile headless` 新建 `claude-memory-verify` profile，`dsh plugin --profile claude-memory-verify add <本目录>` 以 link 装入，`--dump-config` 组合中出现 `# == dsh-claude-memory`（`id: claude-memory`）。headless 任务中模型实际调用了三个工具并返回真实数据：
  - search「发版」全项目 → `Claude memory search “发版” — all projects · 73 matching line(s) in 38 of 905 files (newest first)`
  - read 第一条搜索命中 → `    1→ ## 怎么干活`（duo-updater 的 MEMORY.md 第 1 行）
  - list 默认当前项目 → `Claude memory for project /Users/bobby/Developer/github/duo-updater`
- ⚠️ 尚未安装进 DSH Desktop 的 `desktop` profile（该 profile 由 Electron 应用独占管理，不在 CLI 安装范围）——请按上文在 DSH 的 Plugins 页面安装。
- 验证用的 `~/.dsh/profiles/claude-memory-verify` 保留可复用；不需要时 `rm -rf ~/.dsh/profiles/claude-memory-verify` 即可删除。

## 已知限制

- 不识别 Claude Code 的 `autoMemoryDirectory` 设置覆盖与 `CLAUDE_CODE_PROJECT_DIR_NAME` 环境变量（按默认布局读）。
- 搜索是子串匹配，不是正则或语义检索。
- 位于配置目录内的符号链接会被跟随（`rules/` 常用 symlink 共享，属预期行为）。

## 文件结构

```text
packages/claude-memory/
├── package.json          # bundle manifest（dsh.bundle.patch）
├── cordis.patch.yml      # 插入 claude-memory 行
├── index.js              # Host：三个工具
├── locale/en.json        # 插件管理器显示元数据（英文）
├── locale/zh.json        # 插件管理器显示元数据（中文）
├── icon.svg              # 原创图标
├── test/                 # node:test 测试
└── README.md
```
