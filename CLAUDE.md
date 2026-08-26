@AGENTS.md

<!--
AGENTS.md is the canonical instruction file for this repo, and nearly every coding agent
reads it directly: Codex, Cursor, Copilot's coding agent, VS Code, Gemini CLI, Windsurf,
Zed, Aider, Junie, Jules and others.

Claude Code is the exception. It discovers CLAUDE.md only, so this file exists to point
at AGENTS.md; the line above is Claude Code's import syntax and is expanded at session
start. It is a real file rather than a symlink so that a Windows clone without
core.symlinks (Developer Mode or Administrator) still gets the instructions.

Any tool that reads CLAUDE.md literally rather than expanding the import should read
AGENTS.md instead. Do not copy the instructions into this file: one canonical source.
-->
