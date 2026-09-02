---
name: member-skill-manager
description: Create, install, revise, or retire this Member's private skills, including how a skill manages its configuration and credentials. Read this skill before creating, installing, revising, or retiring any skill in this Member's private skills directory, or when repeated or fragile work has produced a reusable method worth preserving as a skill.
---

# Member Skill Manager

A skill preserves a reusable way of working. It is not a memory, a personal preference, or a record of one event.

## Decide

Create or revise a skill when the method has been demonstrated in real work and will make later work clearer or more reliable. Keep one-off work, changing facts, and personal continuity in this Member's notes and memory index instead.

## Create Or Install

This Member's private skills live in its private skills directory — the absolute path injected into your context (the one ending in `/skills`); it is outside the Workspace cwd, so never use a cwd-relative path for it. A skill is a directory there:

```
<private-skills>/my-skill/
  SKILL.md          # required: front matter + instructions
  references/       # optional: longer material only some uses need
  scripts/          # optional: runnable helpers the skill calls
```

Install an offered skill by copying its directory there; no registration command is needed — the catalog discovers the change within its filesystem-watch window, so a later catalog query lists it. A single flat `.md` file also works, but the directory form is the norm for anything that carries references or scripts.

Use a short lowercase hyphenated name. Keep the directory name and the `name` field the same, and do not reuse a name this catalog already lists (built-ins included).

## Write

Describe the method the next Member turn needs, not general advice it already knows. Make the description name the real triggers. Keep the main instructions in `SKILL.md` short. Put substantial scripts, references, or templates beside `SKILL.md` only when they are repeatedly useful. For a substantial new or revised skill, read [Writing Great Skills](references/writing-great-skills.md).

## Review

Read the finished skill once. Check that its name, description, directory, and method agree, and that nothing already in this Member's catalog owns the same method or name.

Writing or changing a skill adds no tools, credentials, permissions, or external services. The current turn keeps its existing skill list; a later turn discovers the change.

## Configuration and credentials

A skill that needs an API key, token, or other secret keeps it in its own `auth.json` (JSON, one file per skill, inside that skill's directory) and reads it from there at run time; it never puts the secret in `SKILL.md`, scripts, messages, notes, or any other persisted text. Non-secret settings live in `config.json` beside it. Document the exact read/use convention in the skill's `SKILL.md` (file names, expected JSON shape, and how scripts consume them). See [Configuration and Credentials for Skills](references/auth-and-config.md) for the operating convention.
