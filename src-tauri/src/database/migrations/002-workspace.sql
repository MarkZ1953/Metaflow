BEGIN IMMEDIATE;
CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE workspace_roots (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id), path TEXT NOT NULL, name TEXT NOT NULL, UNIQUE(workspace_id,path));
CREATE TABLE workspace_favorites (workspace_id TEXT NOT NULL REFERENCES workspaces(id), path TEXT NOT NULL, PRIMARY KEY(workspace_id,path));
INSERT INTO workspaces VALUES ('default','Metaflow Workspace');
PRAGMA user_version=2;
COMMIT;
