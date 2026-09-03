from pwdlib import PasswordHash

password_hasher = PasswordHash.recommended()


def hash_password(password: str) -> str:
    """使用 Argon2 生成不可逆的密码哈希。"""
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """验证明文密码，不在数据库保存或返回明文。"""
    return password_hasher.verify(password, password_hash)
