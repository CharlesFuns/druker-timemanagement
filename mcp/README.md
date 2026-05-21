# 有效时间 MCP

这个 MCP 是给 Codex 使用的本地入口。它可以把任务、时间记录、复盘写入“有效时间”的 Supabase 数据库，也可以读取飞书任务后导入到“有效时间”。

## 能做什么

- 创建目标、任务、单次日程
- 开始、暂停、完成任务计时
- 补录和修改时间记录
- 保存每日复盘
- 读取飞书任务和飞书日历
- 把飞书任务导入为有效时间任务
- 把飞书日历导入为有效时间日程
- 把某个飞书任务记录为一天里的真实时间片段

## 本机私密配置

项目根目录需要有 `.env.mcp.local`，至少填写：

```bash
EFFECTIVE_TIME_SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service_role key
EFFECTIVE_TIME_USER_EMAIL=你登录有效时间使用的邮箱
```

`.env.mcp.local` 已被忽略，不会上传到 GitHub。

## 典型用法

你可以在 Codex 里这样说：

- “把我今天飞书日历同步到有效时间”
- “把今天飞书待办导入到有效时间任务里，归到工作主线”
- “把‘确认福州PPT内容及细节’记录为今天 10:00 到 10:40 的工作时间”
- “给有效时间补一条 14:00 到 15:30 的会议记录”

如果是其他支持 MCP 的 Agent，也可以复用同一个本地 MCP 配置。

为避免重复同步，创建任务、日程和时间记录时可以带上 `external_source` 和 `external_id`。同一个来源和同一个 ID 再次同步时，会更新原记录，不会重复创建。

## 给其他 Agent 的 HTTPS 同步入口

部署到 Netlify 后，也可以开放一个受保护的同步地址：

```text
POST https://drukertime.top/api/agent-sync
Authorization: Bearer 你的同步口令
```

支持的动作：

- `create_task`：创建任务
- `create_schedule`：创建日程，并进入时间轴
- `add_time_record`：补录时间记录
- `upsert_task`：按外部 ID 新增或更新任务
- `upsert_schedule`：按外部 ID 新增或更新日程
- `upsert_time_record`：按外部 ID 新增或更新时间记录
- `sync_bundle`：一次同步多条任务、日程和时间记录
- `save_daily_review`：保存每日复盘

Netlify 环境变量需要配置：

```bash
SUPABASE_SERVICE_ROLE_KEY=你的 Supabase service_role key
EFFECTIVE_TIME_USER_EMAIL=你登录有效时间的邮箱
AGENT_SYNC_TOKEN=你自己设置的一串同步口令
```

这个同步口令相当于门禁，不要公开。没有配置这些变量时，同步入口不会生效。

示例请求：

```bash
curl -X POST https://drukertime.top/api/agent-sync \
  -H "Authorization: Bearer 你的同步口令" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "upsert_schedule",
    "payload": {
      "title": "飞书会议",
      "start_time": "2026-05-21T10:00:00+08:00",
      "end_time": "2026-05-21T10:40:00+08:00",
      "category": "work",
      "external_source": "feishu_calendar",
      "external_id": "event_xxx"
    }
  }'
```
