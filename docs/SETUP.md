# Supabase 与 Vercel 配置说明

## 1. Supabase

在 Supabase 新建项目后，进入 SQL Editor，完整运行：

```sql
-- 文件位置：supabase/schema.sql
```

这会创建目标、任务、日程、时间片段、觉醒日记和复盘表，并开启数据隔离。每个登录用户只能看到自己的数据。

## 2. 环境变量

本地创建 `.env.local`：

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Vercel 部署时，也需要添加同名环境变量。

## 3. 登录设置

Supabase 默认可能开启邮箱验证。如果只是个人使用，可以在 Supabase 后台关闭邮箱验证；如果要正式上线，建议保留邮箱验证。

## 4. 数据安全

本项目使用 Supabase Row Level Security。只要使用 `supabase/schema.sql` 创建表和规则，用户之间的数据会隔离。
