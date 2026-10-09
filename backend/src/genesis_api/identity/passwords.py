"""复用 pwdlib 的推荐密码哈希实现，不保存或记录明文密码。"""

from pwdlib import PasswordHash

password_hasher = PasswordHash.recommended()


def hash_password(password: str) -> str:
    """使用 Argon2 生成密码哈希。

    Args:
        password: 待保存的明文密码，仅用于本次计算，不得记录。

    Returns:
        含算法参数与盐信息的哈希字符串，供凭据表保存。
    """
    return password_hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    """通过密码库验证密码，不在数据库保存或返回明文。

    Args:
        password: 本次认证提交的明文密码。
        password_hash: 数据库中的哈希字符串。

    Returns:
        密码是否匹配；哈希格式等底层异常按密码库行为传播。
    """
    return password_hasher.verify(password, password_hash)
