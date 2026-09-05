//! 本地工作区凭据恢复(Vincent 2026-09-05:切 Local workspace 报「No matching entry found in
//! secure storage」,本地 Hub 停着,profiles 列表里还有 Local workspace)。
//!
//! 钥匙串里丢了 local-admin 的引导密码时,本地 Hub 的数据库还在、用户还在,只是没人知道密码。
//! 这个数据库由本应用独占(127.0.0.1 上的 bundled Hub;停着的时候只有我们会打开它),所以直接在
//! 库里给 local-admin 换一个新随机密码 —— 哈希格式与 commhub-server `db.ts` 的 `hashPassword`
//! 逐字一致(`scrypt$<log2 N>$<salt b64>$<hash b64>`,N=2^14,r=8,p=1,64 字节输出,16 字节盐),
//! 并像服务端 `resetUserPassword` 一样吊销该用户的旧 token。不动任何其他数据。
use std::{path::Path, time::Duration};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use scrypt::{scrypt, Params};

/// 与 commhub-server 的 DEFAULT_SCRYPT_N / SCRYPT_R / SCRYPT_P / SCRYPT_KEYLEN 相同。
const SCRYPT_LOG_N: u8 = 14;
const SCRYPT_R: u32 = 8;
const SCRYPT_P: u32 = 1;
const SCRYPT_KEYLEN: usize = 64;

pub fn hash_password_with_salt(plain: &str, salt: &[u8]) -> Result<String, String> {
    let params = Params::new(SCRYPT_LOG_N, SCRYPT_R, SCRYPT_P, SCRYPT_KEYLEN)
        .map_err(|error| error.to_string())?;
    let mut output = [0u8; SCRYPT_KEYLEN];
    scrypt(plain.as_bytes(), salt, &params, &mut output).map_err(|error| error.to_string())?;
    Ok(format!(
        "scrypt${SCRYPT_LOG_N}${}${}",
        BASE64.encode(salt),
        BASE64.encode(output)
    ))
}

pub fn hash_password(plain: &str) -> Result<String, String> {
    // 16 字节 OS 随机盐(uuid v4 的 128 位里 122 位随机;盐只要求唯一)。
    hash_password_with_salt(plain, uuid::Uuid::new_v4().as_bytes())
}

/// 与服务端 `verifyPassword` 的 scrypt 分支同一算法;只用于测试(登录验证是 Hub 的事)。
#[cfg(test)]
pub fn verify_password(plain: &str, stored: &str) -> Result<bool, String> {
    let parts: Vec<&str> = stored.split('$').collect();
    if parts.len() != 4 || parts[0] != "scrypt" {
        return Err("not a commhub scrypt hash".into());
    }
    let log_n: u8 = parts[1]
        .parse()
        .map_err(|_| "invalid scrypt cost".to_string())?;
    let salt = BASE64.decode(parts[2]).map_err(|error| error.to_string())?;
    let expected = BASE64.decode(parts[3]).map_err(|error| error.to_string())?;
    let params = Params::new(log_n, SCRYPT_R, SCRYPT_P, expected.len())
        .map_err(|error| error.to_string())?;
    let mut actual = vec![0u8; expected.len()];
    scrypt(plain.as_bytes(), &salt, &params, &mut actual).map_err(|error| error.to_string())?;
    Ok(actual == expected)
}

/// 恢复结果;字段目前只有测试读(生产路径只关心成功与否)。
#[derive(Debug)]
#[cfg_attr(not(test), allow(dead_code))]
pub struct PasswordResetOutcome {
    pub user_id: String,
    pub revoked_tokens: usize,
}

/// 在**停着的**本地 Hub 数据库里把 `username` 的密码换成 `new_password`,并吊销它的
/// 用户级 token(与服务端 `revokeOtherUserTokens(user_id, null)` 相同的 WHERE)。
/// 用户不存在时报错而不是创建 —— 创建用户是 Hub 的事,这里只做恢复。
pub fn reset_local_user_password(
    database: &Path,
    username: &str,
    new_password: &str,
) -> Result<PasswordResetOutcome, String> {
    let mut conn = Connection::open(database)
        .map_err(|error| format!("cannot open local Hub database: {error}"))?;
    conn.busy_timeout(Duration::from_secs(5))
        .map_err(|error| error.to_string())?;
    let user_id: Option<String> = conn
        .query_row(
            "SELECT user_id FROM users WHERE username = ?1",
            params![username],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("cannot read local Hub users: {error}"))?;
    let Some(user_id) = user_id else {
        return Err(format!(
            "local Hub database has no user {username}; use explicit local-data reset"
        ));
    };
    let hash = hash_password(new_password)?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    tx.execute(
        "UPDATE users SET password_hash = ?1, updated_at = datetime('now') WHERE user_id = ?2",
        params![hash, user_id],
    )
    .map_err(|error| error.to_string())?;
    let revoked_tokens = if table_exists(&tx, "api_tokens")? {
        tx.execute(
            "DELETE FROM api_tokens WHERE user_id = ?1 AND network_id IS NULL",
            params![user_id],
        )
        .map_err(|error| error.to_string())?
    } else {
        0
    };
    if table_exists(&tx, "audit_log")? {
        tx.execute(
            "INSERT INTO audit_log (user_id, username, action, target_type, target_id, detail) \
             VALUES (?1, ?2, 'password_reset_by_desktop', 'user', ?1, 'desktop recovered a lost native credential')",
            params![user_id, username],
        )
        .map_err(|error| error.to_string())?;
    }
    tx.commit().map_err(|error| error.to_string())?;
    Ok(PasswordResetOutcome {
        user_id,
        revoked_tokens,
    })
}

fn table_exists(conn: &Connection, name: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
        params![name],
        |_| Ok(()),
    )
    .optional()
    .map(|found| found.is_some())
    .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const FIXTURE_PASSWORD: &str = "desktop-recovery-fixture-A9!";
    const FIXTURE_SALT: [u8; 16] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    // 2026-09-05 由 node:crypto scryptSync(FIXTURE_PASSWORD, FIXTURE_SALT, 64, {N: 1<<14, r: 8, p: 1}) 算出,
    // 即 commhub-server hashPassword 在同一盐下的逐字输出。
    const FIXTURE_HASH: &str = "scrypt$14$AAECAwQFBgcICQoLDA0ODw==$aJ6l4pDGq8cTJgl8mzHq0DiG9hUWWVLXT7JlvEEvCpCTcCsgdNQqZ/fpAx+TrUAsy2CJwpnjHmmk647i8Ox55A==";

    const SCHEMA: &str = "
        CREATE TABLE users (
          user_id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL,
          role TEXT DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE api_tokens (
          token_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, user_id TEXT NOT NULL, network_id TEXT,
          name TEXT NOT NULL DEFAULT 'default', scope TEXT DEFAULT 'full', expires_at TEXT, last_used_at TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE audit_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT, username TEXT, action TEXT NOT NULL,
          target_type TEXT, target_id TEXT, detail TEXT, ip TEXT, network_id TEXT,
          created_at TEXT NOT NULL DEFAULT (datetime('now')));
        INSERT INTO users (user_id, username, password_hash, role) VALUES ('u1', 'local-admin', 'old-hash', 'admin');
        INSERT INTO users (user_id, username, password_hash) VALUES ('u2', 'someone-else', 'other-hash');
        INSERT INTO api_tokens (token_id, token_hash, user_id, network_id) VALUES ('t1', 'h1', 'u1', NULL);
        INSERT INTO api_tokens (token_id, token_hash, user_id, network_id) VALUES ('t2', 'h2', 'u1', 'net_x');
        INSERT INTO api_tokens (token_id, token_hash, user_id, network_id) VALUES ('t3', 'h3', 'u2', NULL);
    ";

    #[test]
    fn hash_matches_commhub_server_scrypt_format_byte_for_byte() {
        assert_eq!(
            hash_password_with_salt(FIXTURE_PASSWORD, &FIXTURE_SALT).unwrap(),
            FIXTURE_HASH
        );
        assert!(verify_password(FIXTURE_PASSWORD, FIXTURE_HASH).unwrap());
        assert!(!verify_password("wrong password", FIXTURE_HASH).unwrap());
        // 随机盐:两次不同,但都能验证
        let a = hash_password(FIXTURE_PASSWORD).unwrap();
        let b = hash_password(FIXTURE_PASSWORD).unwrap();
        assert_ne!(a, b);
        assert!(verify_password(FIXTURE_PASSWORD, &a).unwrap());
        assert!(a.starts_with("scrypt$14$"));
    }

    #[test]
    fn reset_rewrites_hash_revokes_user_tokens_and_audits() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("commhub.db");
        Connection::open(&db).unwrap().execute_batch(SCHEMA).unwrap();

        let outcome = reset_local_user_password(&db, "local-admin", "fresh-password-Z1!").unwrap();
        assert_eq!(outcome.user_id, "u1");
        assert_eq!(outcome.revoked_tokens, 1, "only the user-level (network_id IS NULL) token goes");

        let conn = Connection::open(&db).unwrap();
        let stored: String = conn
            .query_row("SELECT password_hash FROM users WHERE user_id = 'u1'", [], |r| r.get(0))
            .unwrap();
        assert!(verify_password("fresh-password-Z1!", &stored).unwrap());
        assert!(!verify_password("old-hash", &stored).unwrap());
        let other: String = conn
            .query_row("SELECT password_hash FROM users WHERE user_id = 'u2'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(other, "other-hash", "other users untouched");
        let remaining: Vec<String> = conn
            .prepare("SELECT token_id FROM api_tokens ORDER BY token_id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<Result<_, _>>()
            .unwrap();
        assert_eq!(remaining, vec!["t2".to_string(), "t3".to_string()]);
        let audited: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM audit_log WHERE user_id = 'u1' AND action = 'password_reset_by_desktop'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(audited, 1);
    }

    #[test]
    fn reset_refuses_to_invent_a_missing_user() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("commhub.db");
        Connection::open(&db).unwrap().execute_batch(SCHEMA).unwrap();
        let error = reset_local_user_password(&db, "nobody", "x").unwrap_err();
        assert!(error.contains("no user nobody"), "{error}");
        let conn = Connection::open(&db).unwrap();
        let users: i64 = conn.query_row("SELECT COUNT(*) FROM users", [], |r| r.get(0)).unwrap();
        assert_eq!(users, 2);
    }

    #[test]
    fn reset_tolerates_databases_without_token_or_audit_tables() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("commhub.db");
        Connection::open(&db)
            .unwrap()
            .execute_batch(
                "CREATE TABLE users (user_id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, updated_at TEXT);
                 INSERT INTO users VALUES ('u1', 'local-admin', 'old', NULL);",
            )
            .unwrap();
        let outcome = reset_local_user_password(&db, "local-admin", "p").unwrap();
        assert_eq!(outcome.revoked_tokens, 0);
        let stored: String = Connection::open(&db)
            .unwrap()
            .query_row("SELECT password_hash FROM users WHERE user_id = 'u1'", [], |r| r.get(0))
            .unwrap();
        assert!(verify_password("p", &stored).unwrap());
    }
}
