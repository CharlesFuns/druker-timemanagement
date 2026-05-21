# 有效时间 MCP

这里有两种接入方式：

1. `effective-time-mcp.js`：站长本机私密版，直接连 Supabase，可读取飞书并导入。
2. `effective-time-remote-mcp.cjs`：多人安全版，只通过 `drukertime.top` 的个人 Agent 口令写入当前用户自己的数据。

## 多人安全版：给同事使用

同事不需要 Supabase 密钥。流程是：

1. 登录 `https://drukertime.top`
2. 打开「Agent 接入」页面
3. 生成自己的 Agent 口令
4. 下载 `https://drukertime.top/effective-time-remote-mcp.cjs`
5. 把页面里的 MCP 配置复制到自己的 Codex 配置

这个口令只绑定当前登录用户。它能创建任务、开始/暂停/完成任务、创建日程、补录或修改时间记录、保存每日复盘；不能读取或使用站长的 Supabase 后台密钥，也不能操作其他人的数据。

## 站长私密版：本机使用

项目根目录需要有 `.env.mcp.local`，至少填写：

```bash
EFFECTIVE_TIME_SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service_role key
EFFECTIVE_TIME_USER_EMAIL=你登录有效时间使用的邮箱
```

`.env.mcp.local` 已被忽略，不会上传到 GitHub。

站长私密版额外支持：

- 读取飞书任务和飞书日历
- 把飞书任务导入为有效时间任务
- 把飞书日历导入为有效时间日程
- 把某个飞书任务记录为一天里的真实时间片段

## HTTPS 同步入口

线上入口：

```text
POST https://drukertime.top/api/agent-sync
Authorization: Bearer 个人 Agent 口令
```

支持的动作包括：

- `health`
- `list_goals`
- `create_goal`
- `list_tasks`
- `create_task` / `upsert_task`
- `start_task`
- `pause_task`
- `complete_task`
- `list_schedules`
- `create_schedule` / `upsert_schedule`
- `list_day_records`
- `add_time_record` / `upsert_time_record`
- `update_time_record`
- `save_daily_review`
- `sync_bundle`

为避免重复同步，创建任务、日程和时间记录时可以带上 `external_source` 和 `external_id`。同一个来源和同一个 ID 再次同步时，会更新原记录，不会重复创建。
