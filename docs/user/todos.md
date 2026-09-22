# To-dos

To-dos provide one place to capture work before it becomes a thread. Open **To-dos** from the main sidebar or command palette.

New items start in the Inbox unless you choose a project. The overview shows only each title and a short outcome summary. Open an item to see its child to-dos first, followed by concise generated summaries of its specification, context, glossary, and plan. Expand a section when you want to read or edit its full text.

Use **Plan** to open a dedicated chat with a planning agent. The agent begins by asking focused questions about the desired outcome, scope, constraints, and acceptance criteria instead of guessing. After you confirm the proposal, the agent must finish by submitting a structured outcome summary, specification, context, glossary, implementation plan, and high-level subtasks. Until that submission succeeds, the session remains marked as in progress. A successful submission updates the parent to-do and creates every proposed subtask as a full child to-do.

The hidden instructions used for these planning chats can be changed under **Settings → General → To-do planning instructions**. They guide the agent without appearing as a user message.

Child to-dos have their own outcome summary, specification, context, and completion state. Open one to edit it like any other to-do, or start it as an independent thread. They retain their link to the parent so the planning view can show the overall plan and its execution breakdown together.

Completing a to-do shows an immediate **Undo** action and moves the item into the flat **Completed** section below active to-dos. Its crossed-out title still opens the details page, and its checkmark reopens it directly.

Use **Start** to open a new draft thread in the assigned project. Inbox items start threads in T3 Code's managed Workspace. The title and notes become the draft prompt so they can still be refined before sending. Items can be completed, reopened, or deleted independently of the thread.

To-dos are stored by the connected T3 environment and stay available across clients connected to that environment.

To-dos also appear in global search results. In **New thread in…**, Projects remain the default; press `Tab` to switch between Projects and To-dos without losing your search. **To-do Search: Toggle** opens the same picker directly on To-dos; its default shortcut is `Mod+Shift+K` and it can be changed in **Settings → Keybindings**. Selecting an assigned to-do creates a draft in its project and fills the prompt from the to-do title and notes.
