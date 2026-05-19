# Skills Editor — User Guide

The Skills Editor is where you customize how the DA assistant works on your site. You can teach it new abilities, create reusable prompts, connect external tools, and see what it has learned over time.

## Getting Started

Open the Skills Editor from the chat menu (click **+** then **Manage Skills** or **Manage Prompts**), or navigate directly to your site's skills URL. You'll be asked to select your **Organization** and **Site** — these are the same org/site you use in Browse or Canvas.

The editor has two panels: a **catalog list** on the left showing all your items, and an **editor panel** on the right where you create or edit them. There's also an optional **Chat** drawer you can open to test things as you go.

Five tabs organize everything:

| Tab | What's here |
|-----|-------------|
| **Skills** | Instructions the agent can follow |
| **Agents** | Agent presets and their tool configurations |
| **Prompts** | Reusable prompt templates |
| **MCPs** | External tool servers |
| **Memory** | What the agent has learned about your site |

---

## Skills

Skills are markdown instructions that teach the agent how to do something specific to your site — for example, "how to format a product page" or "brand voice guidelines."

### Creating a skill

1. Click **+ New Skill**
2. Enter a **Skill ID** (this becomes the filename — choose something descriptive like `brand-voice` or `product-page-layout`)
3. Write the skill body in **Markdown**
4. Click **Save** to make it live, or **Save Draft** to keep working on it

The editor automatically adds frontmatter (the `---` block at the top) if you don't include one. Fill in the **description** field — it helps the agent decide when to use your skill.

You can also create skills by placing `.md` files directly in the `/.da/skills/` folder of your site. The Skills Editor will pick them up automatically and sync them with the config sheet. If you go this route, include YAML frontmatter at the top of each file:

```yaml
---
name: brand-voice
description: Guidelines for writing in our brand's tone and style
status: approved
---

# Brand Voice

Your skill instructions here...
```

| Field | Rules |
|-------|-------|
| **name** | Required. Lowercase letters, numbers, and hyphens only. Max 64 characters. |
| **description** | Recommended. Helps the agent decide when to use this skill. Max 1024 characters. |
| **status** | `approved` (agent can use it) or `draft` (hidden from agent) |

If you omit the frontmatter, the editor will inject a minimal one using the filename as the name when it syncs.

### Draft vs Approved

- **Draft** (gray dot) — the agent won't use this skill yet; it's still a work in progress
- **Approved** (green dot) — the agent can discover and use this skill during conversations

### Managing skills

- Use the **search bar** to find skills by name
- Filter by **Approved**, **Draft**, or **All**
- Click a skill card to edit it
- Use the **...** menu to delete a skill (this can't be undone)

---

## Agents

Agents are presets that define which tools and skills are available during a conversation.

### Built-in agent: DA Assistant

Every site comes with **DA Assistant** — the default content authoring agent. It has access to core DA tools (reading, writing, managing content) and Edge Delivery Services (preview and publish). You can't delete it, but you can inspect what tools it uses.

### Creating a custom agent

1. Click **+ New Agent**
2. Enter an **Agent ID** (e.g. `content-reviewer`)
3. Optionally add a **Display name**
4. Click **Save Agent File**

This creates an agent preset file at `/.da/agents/<id>.json`. Custom agents are local configuration — they don't have an endpoint URL. They define which skills and MCP servers the agent can use for conversations on your site.

The starter file looks like this:

```json
{
  "name": "Content Reviewer",
  "description": "",
  "systemPrompt": "",
  "skills": [],
  "mcpServers": []
}
```

| Field | What it does |
|-------|--------------|
| **name** | Display name shown in the UI |
| **description** | What this agent is for (shown on the agent card) |
| **systemPrompt** | Custom system prompt that shapes how the agent behaves |
| **skills** | List of skill IDs this agent can use (e.g. `["brand-voice", "seo-guidelines"]`) |
| **mcpServers** | List of MCP server IDs this agent can access (e.g. `["da-tools", "my-translation-api"]`) |

To customize the agent after creation, edit the JSON file directly (via Canvas or your editor of choice). For example, a content reviewer agent might look like:

```json
{
  "name": "Content Reviewer",
  "description": "Reviews pages for brand compliance and accessibility",
  "systemPrompt": "You are a content reviewer. Check every page against our brand guidelines and WCAG 2.1 AA standards.",
  "skills": ["brand-voice", "accessibility-checklist"],
  "mcpServers": ["da-tools", "my-translation-api"]
}
```

**Important**: the skills and MCP servers you reference in the agent preset must already exist on your site before the agent can use them:

- **Skills** must be created first in the **Skills** tab (with status **Approved**)
- **MCP servers** must be registered first in the **MCPs** tab (with a valid endpoint URL and status **Approved + Enabled**)

The agent preset only references them by ID — it doesn't define them. Think of it as assembling a toolkit: you stock the shelves first (create skills, register MCP servers), then tell the agent which items to pick up (list their IDs in the preset).

### Viewing an agent's tools

Click any agent card to see **Associated Tools** — a breakdown of every tool available to that agent, grouped by MCP server. You can toggle individual tools on or off for your site.

### Dependency view

Toggle **Dependency view** to see a tree diagram showing how each agent connects to skills, MCP servers, and individual tools.

---

## Prompts

Prompts are reusable text templates you can save and quickly send to the chat. Great for common tasks like "Review this page for accessibility" or "Summarize the content in this folder."

Prompts are stored in the **prompts** sheet of your site's DA config (`.da/config`). You can create and manage them through the Skills Editor UI, or add them directly to the config sheet if you prefer — both methods are equivalent. Bulk-adding prompts via the sheet can be faster for initial setup.

### Creating a prompt

1. Click **+ New Prompt**
2. Enter a **Title** (e.g. "Accessibility Review")
3. Choose a **Category** (Review, Workflow, Style, or Content)
4. Write the **Prompt body** — the actual text that gets sent to the agent
5. Click **Save**

### Using prompts

From the prompt list, you can:

- **Add to chat** — inserts the prompt text into the chat input so you can edit it before sending
- **Run** — sends the prompt to chat immediately
- **Duplicate** — creates a copy you can modify
- **Edit** or **Delete** from the row actions

Prompts appear in the chat welcome screen and the prompts popover so authors can quickly access them.

---

## MCP Servers

MCP (Model Context Protocol) servers are external tool providers that extend what the agent can do. For example, you might connect a translation service, a design system API, or a custom content pipeline.

### Built-in servers

Two servers are always available:

| Server | What it does |
|--------|--------------|
| **da-tools** | Core DA operations — read, write, list, copy, move, delete content, manage skills and agents, upload media |
| **eds-preview** | Preview and publish content to Edge Delivery Services |

Click a built-in server card to see the full list of its tools.

### Registering a custom MCP server

1. Click **+ Register MCP**
2. Fill in the form:

| Field | Required | What to enter |
|-------|----------|---------------|
| **Server ID** | Yes | A short identifier (e.g. `my-translation-api`) |
| **SSE endpoint URL** | Yes | The server's SSE endpoint URL |
| **Description** | No | What this server does |
| **Auth header name** | No | The header name for authentication (e.g. `Authorization` or `x-api-key`) |
| **Auth header value** | No | The secret key or token |

3. Click **Register**

**Important**: Auth keys saved here are visible to anyone with site configuration permission. Don't store highly sensitive credentials unless you're comfortable with that access level.

### Managing MCP servers

- **Enable/Disable** — from the **...** menu on custom server cards. Disabled servers won't connect or expose tools to the agent.
- **Edit** — click a custom server card to update its URL, description, or auth settings
- **Delete** — from the **...** menu (can't be undone)
- **Per-tool toggles** — when viewing a server's tools, use the checkboxes to enable or disable individual tools site-wide

### How tool discovery works

When you view an MCP server's tools, the editor asks the DA agent to connect to the server and report what tools are available. You'll see a brief "Connecting..." message. If the server is unreachable or returns an error, the editor shows a helpful message with hints on what might be wrong.

Only servers that are **approved and enabled** with a valid URL will have their tools discovered.

---

## Memory

The Memory tab shows **project memory** — long-lived notes the DA agent accumulates as it works with your site. Think of it as the agent's notebook about your project.

- Memory is **read-only** in this view — the agent writes to it automatically as it learns
- Stored at `/.da/agent/memory.md`
- If no memory exists yet, you'll see: *"No project memory yet. The DA agent writes here as it learns about your site."*

---

## Tips

- **Use Draft mode** while iterating on skills — switch to Approved when you're confident
- **Test prompts in Chat** before sharing them with your team
- **Check the Dependency view** on the Agents tab to understand how everything connects
- **Start simple** — the built-in DA Assistant with default tools handles most authoring tasks. Add skills and custom MCPs as specific needs arise
