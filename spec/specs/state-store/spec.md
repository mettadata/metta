# StateStore — Specification

**Status:** Imported  
**Source:** `src/state/state-store.ts`, `tests/state-store.test.ts`  
**Date:** 2026-04-06

---

## 1. Overview

`StateStore` is a file-backed persistence layer for all metta runtime state. It stores data as YAML files under a configurable base path, enforces Zod schema validation on every read and write, and provides advisory file locking for cross-process mutual exclusion. Raw (unvalidated) string I/O is also supported for non-structured artifacts such as markdown and logs.

---

## 2. Error Types

### 2.1 StateValidationError

- MUST be thrown whenever a read or write operation fails Zod schema validation.
- MUST carry the name `"StateValidationError"`.
- MUST expose a public `issues` property of type `z.ZodIssue[]` containing all Zod validation failures.

### 2.2 StateLockError

- MUST be thrown when `acquireLock` exhausts its timeout without successfully claiming the lock file.
- MUST carry the name `"StateLockError"`.

---

## 3. Constructor

```
new StateStore(basePath: string)
```

- `basePath` is the root directory for all file operations. All relative `filePath` arguments are resolved against this base.
- The constructor MUST NOT perform any I/O.

---

## 4. Methods

### 4.1 `read<T>(filePath, schema)`

- MUST resolve `filePath` relative to `basePath`.
- MUST read the file as UTF-8 and parse it as YAML.
- MUST run the parsed data through `schema.safeParse`.
- MUST return the validated, typed data on success.
- MUST throw `StateValidationError` if schema validation fails, including when the YAML contains extra fields rejected by a `.strict()` schema.
- MUST propagate any filesystem error (e.g., `ENOENT`) from the underlying `readFile` call.

### 4.2 `write<T>(filePath, schema, data)`

- MUST validate `data` against `schema` before writing.
- MUST throw `StateValidationError` if validation fails; no file MUST be written in that case.
- MUST create all parent directories recursively before writing.
- MUST serialize validated data as YAML (using `lineWidth: 0` to prevent wrapping) and write as UTF-8.
- MUST overwrite any existing file at the resolved path.

### 4.3 `exists(filePath)`

- MUST return `true` if a file exists at the resolved path.
- MUST return `false` if the file does not exist; it MUST NOT throw for a missing file.

### 4.4 `readRaw(filePath)`

- MUST read and return the file contents as a raw UTF-8 string.
- MUST NOT perform any YAML parsing or schema validation.
- MUST propagate filesystem errors.

### 4.5 `writeRaw(filePath, content)`

- MUST create all parent directories recursively before writing.
- MUST write `content` as a raw UTF-8 string without YAML serialization or schema validation.

### 4.6 `delete(filePath)`

- MUST delete the file at the resolved path.
- MUST propagate any filesystem error (e.g., if the file does not exist).

### 4.7 `getFullPath(filePath)`

- MUST return the absolute path produced by joining `basePath` and `filePath`.
- MUST NOT perform any I/O.

### 4.8 `acquireLock(lockFile, timeout?)`

- `timeout` defaults to `5000` ms when not provided.
- MUST attempt to create the lock file using the exclusive `wx` flag (atomic create-if-not-exists).
- On success, MUST write a JSON object containing `pid` (current process PID) and `acquired` (ISO-8601 timestamp) into the lock file.
- MUST return an async release function that deletes the lock file.
- The release function MUST NOT throw if the lock file was already removed before release.
- While the lock is held by another process, MUST poll every 100 ms.
- MUST check lock file age on each poll attempt; if the lock file's mtime is more than 60,000 ms old, the lock MUST be considered stale, deleted, and acquisition retried.
- MUST throw `StateLockError` if the lock is not acquired within `timeout` milliseconds.

---

## 5. Behavioral Scenarios

### 5.1 Write and Read Round-Trip

**Given** a `StateStore` with a valid base path  
**When** `write` is called with a Zod schema and conforming data  
**Then** the data MUST be persisted as YAML  
**And** a subsequent `read` with the same schema MUST return a value deep-equal to the original data.

---

### 5.2 Nested Directory Creation

**Given** a `filePath` such as `deep/nested/test.yaml` that does not yet exist  
**When** `write` or `writeRaw` is called  
**Then** all intermediate directories MUST be created automatically  
**And** the write MUST succeed.

---

### 5.3 Read Validation Failure

**Given** a YAML file whose contents do not conform to the provided schema  
**When** `read` is called  
**Then** a `StateValidationError` MUST be thrown  
**And** the `issues` array MUST be non-empty.

---

### 5.4 Write Validation Failure

**Given** data that does not conform to the provided schema  
**When** `write` is called  
**Then** a `StateValidationError` MUST be thrown  
**And** no file MUST be written or modified.

---

### 5.5 Strict Schema Rejection

**Given** a YAML file containing fields not declared in a `.strict()` schema  
**When** `read` is called with that schema  
**Then** a `StateValidationError` MUST be thrown.

---

### 5.6 Lock Acquire and Release

**Given** no lock file exists  
**When** `acquireLock` is called  
**Then** a lock file MUST appear at the resolved path  
**And** the returned release function, when called, MUST delete the lock file.

---

### 5.7 Lock Contention

**Given** a lock is already held  
**When** a second `acquireLock` call is made with a short timeout  
**Then** a `StateLockError` MUST be thrown after the timeout elapses.

---

### 5.8 Stale Lock Removal

**Given** a lock file whose mtime is more than 60 seconds in the past  
**When** `acquireLock` is called  
**Then** the stale lock file MUST be deleted  
**And** the new lock MUST be acquired.

---

### 5.9 Raw Round-Trip

**Given** a raw string (e.g., markdown content)  
**When** `writeRaw` is called followed by `readRaw`  
**Then** the returned string MUST be byte-for-byte identical to the original.

---

### 5.10 Exists

**Given** a file written via `writeRaw`  
**When** `exists` is called  
**Then** it MUST return `true`.

**Given** no file at the path  
**When** `exists` is called  
**Then** it MUST return `false` and MUST NOT throw.

---

## 6. Implementation Constraints

- All paths MUST be resolved relative to `basePath` via `join(basePath, filePath)`. Callers MUST NOT pass absolute paths as `filePath`.
- YAML serialization MUST use `lineWidth: 0` to avoid line-folding that can corrupt long string values.
- The lock mechanism is advisory; it does not prevent direct filesystem access by code that bypasses `acquireLock`.
- `StateStore` MUST NOT maintain any in-memory cache of file contents.

---

## 7. Dependencies

| Dependency | Version Constraint | Purpose |
|---|---|---|
| `zod` | workspace | Schema validation |
| `yaml` | workspace | YAML parse/stringify |
| `node:fs/promises` | Node.js >= 22 | File I/O |
| `node:path` | Node.js built-in | Path resolution |
