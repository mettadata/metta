# Execution: {task_id}

## Task
{task_description}

## Files
{file_list}

## Action
{what_to_implement}

## Verify
{verification_steps}

## Done
{acceptance_criteria}

## Rules
- Commit atomically after completing the task
- Run gates (tests, lint, typecheck) before committing
- If you discover a bug, fix it and commit separately (Deviation Rule 1)
- If a critical piece is missing, add it and commit separately (Deviation Rule 2)
- If blocked by infrastructure, fix if < 10 lines, else escalate (Deviation Rule 3)
- If the design is wrong or a major change is needed, STOP immediately (Deviation Rule 4)
