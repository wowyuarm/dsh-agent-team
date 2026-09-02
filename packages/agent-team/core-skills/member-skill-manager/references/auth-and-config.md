# Configuration and Credentials for Skills

A skill may need credentials (API keys, tokens) or non-secret configuration (endpoints, limits, defaults). This is the operating convention for how a Member manages those files when installing an external skill or creating its own.

## File layout

Every skill keeps its own files inside its skill directory:

- `auth.json` — credentials. JSON object; one entry per service or purpose, e.g. `{"weread": "<api-key>"}`.
- `config.json` — non-secret configuration. JSON object; whatever the skill needs, e.g. `{"baseUrl": "https://...", "maxResults": 5}`.

A skill that needs neither file simply does not have them. Do not scatter credential files elsewhere or share one file across skills.

## Writing a skill's SKILL.md

The skill's `SKILL.md` must document how the skill reads these files:

- the exact file names and expected JSON shape,
- how scripts consume them (for example `AUTH=$(cat auth.json)` in a shell script, or `json.load(open("auth.json"))` in Python, resolved relative to the skill directory),
- which config keys exist and what they do.

## What never goes in plain text

Credentials do not appear in `SKILL.md`, in scripts, in messages, in notes, in the Member's memory index, or in any other persisted or shared text. Scripts read them from `auth.json` at run time; they are never echoed into output, logs, or chat. When a Human provides a credential through a DM or attachment, write it into the skill's `auth.json` and reference it only as a file.

## Creating or installing a skill

- Create or copy the skill directory into this Member's private skills directory (the absolute injected path ending in `/skills`).
- If the skill needs credentials or configuration, create `auth.json` / `config.json` in that directory with the layout above and document the read convention in its `SKILL.md`.
- When the skill is a copy of an external skill that already has its own layout, keep that layout unless it conflicts with this convention; resolve conflicts by moving credentials into `auth.json` and updating `SKILL.md` accordingly.
