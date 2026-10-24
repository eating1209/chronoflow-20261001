package com.chronoflow.auth.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.chronoflow.auth.config.AuthProperties;
import com.chronoflow.auth.dto.AuthDtos.IdentitySummary;
import com.chronoflow.auth.dto.AuthDtos.SmsLoginResponse;
import com.chronoflow.auth.dto.AuthDtos.TokenResponse;
import com.chronoflow.auth.dto.IdentityView;
import com.chronoflow.auth.entity.Account;
import com.chronoflow.auth.entity.Identity;
import com.chronoflow.auth.mapper.AccountMapper;
import com.chronoflow.auth.mapper.IdentityMapper;
import com.chronoflow.auth.security.IdentityPrincipal;
import com.chronoflow.auth.security.TokenScope;
import com.chronoflow.auth.store.RefreshTokenRecord;
import com.chronoflow.auth.store.VerificationCodeStore;
import com.chronoflow.common.api.ErrorCode;
import com.chronoflow.common.exception.BizException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Optional;

/**
 * 认证编排：短信登录 → 身份列表 → 选择身份 → 签发令牌，以及令牌刷新、身份切换与登出。
 * 流程见 spec §3.2。
 */
@Service
public class AuthService {

    private static final String STATUS_ACTIVE = "ACTIVE";
    private static final String STATUS_DISABLED = "DISABLED";

    private final AccountMapper accountMapper;
    private final IdentityMapper identityMapper;
    private final VerificationCodeService verificationCodeService;
    private final VerificationCodeStore verificationCodeStore;
    private final AuthProperties properties;
    private final TokenService tokenService;
    private final org.springframework.security.crypto.password.PasswordEncoder passwordEncoder;

    public AuthService(AccountMapper accountMapper,
                       IdentityMapper identityMapper,
                       VerificationCodeService verificationCodeService,
                       VerificationCodeStore verificationCodeStore,
                       AuthProperties properties,
                       TokenService tokenService,
                       org.springframework.security.crypto.password.PasswordEncoder passwordEncoder) {
        this.accountMapper = accountMapper;
        this.identityMapper = identityMapper;
        this.verificationCodeService = verificationCodeService;
        this.verificationCodeStore = verificationCodeStore;
        this.properties = properties;
        this.tokenService = tokenService;
        this.passwordEncoder = passwordEncoder;
    }

    /**
     * 手机号 + 密码登录。走与短信登录完全相同的身份列表流程，
     * 便于账号同时拥有个人身份与多个组织身份时统一选择（spec §3.3）。
     */
    public SmsLoginResponse loginByPassword(String phone, String password, String deviceId) {
        // 先看有没有被锁：不加这一道，攻击者可以对 11 位手机号慢慢穷举，密码强度形同虚设
        if (verificationCodeStore.countPasswordFailures(phone) >= properties.getPasswordMaxAttempts()) {
            throw BizException.of(ErrorCode.PASSWORD_LOCKED);
        }
        Account account = accountMapper.selectOne(
                new LambdaQueryWrapper<Account>().eq(Account::getPhone, phone));
        if (account == null || account.getPasswordHash() == null) {
            throw BizException.of(ErrorCode.PASSWORD_NOT_SET);
        }
        if (STATUS_DISABLED.equals(account.getStatus())) {
            throw BizException.of(ErrorCode.ACCOUNT_DISABLED);
        }
        if (!passwordEncoder.matches(password, account.getPasswordHash())) {
            long failures = verificationCodeStore.incrementPasswordFailure(
                    phone, properties.getPasswordLockWindow());
            if (failures >= properties.getPasswordMaxAttempts()) {
                throw BizException.of(ErrorCode.PASSWORD_LOCKED);
            }
            throw BizException.of(ErrorCode.PASSWORD_MISMATCH, "手机号或密码不正确");
        }
        verificationCodeStore.clearPasswordFailure(phone);
        account.setLastLoginAt(OffsetDateTime.now(ZoneOffset.UTC));
        accountMapper.updateById(account);
        return issueLoginChallenge(account, deviceId);
    }

    /**
     * 注册账号：手机号 + 短信验证码 + 自设密码。
     *
     * <p>验证码的作用是证明手机号在本人手里——没有它，任何人都能拿别人的手机号注册。
     * 已注册的号码不在这里静默改密（那会变成「知道手机号就能重置密码」），
     * 而是明确拒绝，让用户去登录或走「忘记密码」。
     */
    @Transactional
    public SmsLoginResponse registerWithPassword(String phone, String code, String newPassword, String deviceId) {
        PasswordPolicy.validate(newPassword);
        verificationCodeService.verify(phone, code);

        Account existing = accountMapper.selectOne(
                new LambdaQueryWrapper<Account>().eq(Account::getPhone, phone));
        if (existing != null) {
            throw BizException.of(ErrorCode.PARAM_INVALID,
                    "该手机号已注册，请直接登录；想设置密码可在「我的 → 账号与安全 → 登录密码」设置，或使用「忘记密码」重置");
        }
        Account account = createAccount(phone);
        account.setPasswordHash(passwordEncoder.encode(newPassword));
        accountMapper.updateById(account);
        verificationCodeStore.clearPasswordFailure(phone);
        return issueLoginChallenge(account, deviceId);
    }

    /**
     * 忘记密码：短信验证码 + 新密码。
     *
     * <p>能收到这条短信就说明手机号还在本人手里，所以不必再要旧密码；
     * 但重置成功后要把**所有设备**的刷新令牌吊销（和改密一致），否则偷到令牌的人还能继续用。
     */
    @Transactional
    public void resetPasswordBySms(String phone, String code, String newPassword) {
        PasswordPolicy.validate(newPassword);
        verificationCodeService.verify(phone, code);

        Account account = accountMapper.selectOne(
                new LambdaQueryWrapper<Account>().eq(Account::getPhone, phone));
        if (account == null) {
            throw BizException.of(ErrorCode.PARAM_INVALID, "该手机号尚未注册");
        }
        if (STATUS_DISABLED.equals(account.getStatus())) {
            throw BizException.of(ErrorCode.ACCOUNT_DISABLED);
        }
        account.setPasswordHash(passwordEncoder.encode(newPassword));
        accountMapper.updateById(account);
        tokenService.revokeAllForAccount(account.getId());
        verificationCodeStore.clearPasswordFailure(phone);
    }

    /**
     * 手机号 + 验证码登录。注册与登录合一：手机号首次登录时自动创建账号。
     */
    @Transactional
    public SmsLoginResponse loginBySms(String phone, String code, String deviceId) {
        verificationCodeService.verify(phone, code);

        Account account = accountMapper.selectOne(
                new LambdaQueryWrapper<Account>().eq(Account::getPhone, phone));
        if (account == null) {
            account = createAccount(phone);
        } else {
            if (STATUS_DISABLED.equals(account.getStatus())) {
                throw BizException.of(ErrorCode.ACCOUNT_DISABLED);
            }
            account.setLastLoginAt(OffsetDateTime.now(ZoneOffset.UTC));
            accountMapper.updateById(account);
        }

        return issueLoginChallenge(account, deviceId);
    }

    /**
     * 登录成功后的统一分支（spec §3.2）：**只认个人身份**。
     *
     * <p>没有个人身份就下发注册令牌引导创建；有就直接签发它的令牌对。
     * 组织身份不参与登录——它只能通过「登录组织账号」产生（§4.2.5），
     * 因此登录页永远不会有「选身份」这一步。
     */
    private SmsLoginResponse issueLoginChallenge(Account account, String deviceId) {
        Identity personal = identityMapper.selectOne(new LambdaQueryWrapper<Identity>()
                .eq(Identity::getAccountId, account.getId())
                .eq(Identity::getIdentityType, Identity.TYPE_PERSONAL)
                .last("LIMIT 1"));
        if (personal == null) {
            String registerToken = tokenService.issueScopedToken(
                    account.getId(), TokenScope.REGISTER, tokenService.properties().getRegisterTokenTtl());
            return SmsLoginResponse.register(registerToken);
        }
        return SmsLoginResponse.loggedIn(selectIdentity(account.getId(), personal.getId(), deviceId));
    }

    /**
     * 创建个人身份并直接签发令牌（首次登录后的引导步骤）。
     */
    @Transactional
    public TokenResponse createPersonalIdentity(Long accountId, String nickname, String avatarUrl, String deviceId) {
        Account account = accountMapper.selectById(accountId);
        if (account == null) {
            throw BizException.of(ErrorCode.UNAUTHENTICATED);
        }

        Long existing = identityMapper.selectCount(new LambdaQueryWrapper<Identity>()
                .eq(Identity::getAccountId, accountId)
                .eq(Identity::getIdentityType, Identity.TYPE_PERSONAL));
        if (existing != null && existing > 0) {
            throw BizException.of(ErrorCode.MEMBER_ALREADY_EXISTS, "该账号已存在个人身份");
        }

        Identity identity = new Identity();
        identity.setAccountId(accountId);
        identity.setIdentityType(Identity.TYPE_PERSONAL);
        identity.setNickname(StringUtils.hasText(nickname) ? nickname : defaultNickname(account.getPhone()));
        identity.setAvatarUrl(avatarUrl);
        identity.setStatus(STATUS_ACTIVE);
        identityMapper.insert(identity);

        String refreshToken = tokenService.issueRefreshToken(accountId, identity.getId(), deviceId);
        return buildTokenResponse(accountId, identity, refreshToken);
    }

    /**
     * 选定身份并签发令牌。
     */
    @Transactional
    public TokenResponse selectIdentity(Long accountId, Long identityId, String deviceId) {
        Identity identity = requireOwnedIdentity(accountId, identityId);
        String refreshToken = tokenService.issueRefreshToken(accountId, identity.getId(), deviceId);
        return buildTokenResponse(accountId, identity, refreshToken);
    }

    /**
     * 刷新访问令牌。刷新令牌采用滑动过期 + 轮换：只要用户在刷新令牌有效期内使用过 App，
     * 有效期就自动延长，因此正常使用过程中不会被打断（spec §3.7）。
     *
     * <p>并发刷新（App 同时发起多个请求）通过轮换宽限期兜底：旧令牌在宽限期内被再次提交时，
     * 返回同一个新令牌，而不是判定为失效并强制用户重新登录。
     */
    @Transactional
    public TokenResponse refresh(String refreshToken, String deviceId) {
        Optional<RefreshTokenRecord> current = tokenService.findRefreshToken(refreshToken);
        if (current.isEmpty()) {
            return reuseRotatedSuccessor(refreshToken);
        }

        RefreshTokenRecord record = current.get();
        requireActiveAccount(record.accountId());
        Identity identity = requireActiveIdentity(record.identityId());

        String newRefreshToken = tokenService.issueRefreshToken(record.accountId(), identity.getId(), deviceId);
        tokenService.linkRotation(refreshToken, newRefreshToken);
        return buildTokenResponse(record.accountId(), identity, newRefreshToken);
    }

    /**
     * 切换身份：凭刷新令牌换发绑定目标身份的新令牌，无需重新走验证码。
     */
    @Transactional
    public TokenResponse switchIdentity(String refreshToken, Long targetIdentityId, String deviceId) {
        RefreshTokenRecord record = tokenService.requireRefreshToken(refreshToken);
        requireActiveAccount(record.accountId());
        // 目标身份非法时直接失败，且不消耗原刷新令牌，避免误踢用户
        Identity identity = requireOwnedIdentity(record.accountId(), targetIdentityId);

        String newRefreshToken = tokenService.issueRefreshToken(record.accountId(), identity.getId(), deviceId);
        tokenService.linkRotation(refreshToken, newRefreshToken);
        return buildTokenResponse(record.accountId(), identity, newRefreshToken);
    }

    /**
     * 宽限期内的并发刷新兜底：旧令牌已被轮换掉，但轮换关系仍在，取回同一个新令牌。
     */
    private TokenResponse reuseRotatedSuccessor(String previousRefreshToken) {
        String successorToken = tokenService.findRotatedSuccessor(previousRefreshToken)
                .orElseThrow(() -> BizException.of(ErrorCode.REFRESH_TOKEN_INVALID));
        RefreshTokenRecord successor = tokenService.findRefreshToken(successorToken)
                .orElseThrow(() -> BizException.of(ErrorCode.REFRESH_TOKEN_INVALID));
        requireActiveAccount(successor.accountId());
        Identity identity = requireActiveIdentity(successor.identityId());
        return buildTokenResponse(successor.accountId(), identity, successor.tokenId());
    }

    public void logout(String refreshToken) {
        tokenService.revokeRefreshToken(refreshToken);
    }

    public List<IdentityView> listIdentities(Long accountId) {
        return identityMapper.selectIdentityViews(accountId);
    }

    public IdentityView currentIdentityView(Long accountId, Long identityId) {
        return identityMapper.selectIdentityViews(accountId).stream()
                .filter(view -> view.getIdentityId().equals(identityId))
                .findFirst()
                .orElseThrow(() -> BizException.of(ErrorCode.IDENTITY_UNAVAILABLE));
    }

    private Account createAccount(String phone) {
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        Account account = new Account();
        account.setPhone(phone);
        account.setPhoneVerifiedAt(now);
        account.setStatus(STATUS_ACTIVE);
        account.setLastLoginAt(now);
        accountMapper.insert(account);
        return account;
    }

    private Identity requireOwnedIdentity(Long accountId, Long identityId) {
        Identity identity = requireActiveIdentity(identityId);
        if (!identity.getAccountId().equals(accountId)) {
            throw BizException.of(ErrorCode.IDENTITY_NOT_OWNED);
        }
        return identity;
    }

    private Identity requireActiveIdentity(Long identityId) {
        Identity identity = identityMapper.selectById(identityId);
        if (identity == null || !STATUS_ACTIVE.equals(identity.getStatus())) {
            throw BizException.of(ErrorCode.IDENTITY_UNAVAILABLE);
        }
        return identity;
    }

    private TokenResponse buildTokenResponse(Long accountId, Identity identity, String refreshToken) {
        IdentityPrincipal principal = new IdentityPrincipal(
                accountId, identity.getId(), identity.getIdentityType(), identity.getOrgId());
        String accessToken = tokenService.issueAccessToken(principal);

        IdentitySummary summary = new IdentitySummary(
                accountId, identity.getId(), identity.getIdentityType(), identity.getOrgId(),
                identity.getNickname(), identity.getAvatarUrl());

        return new TokenResponse(accessToken, refreshToken, tokenService.accessTokenTtlSeconds(), summary);
    }

    /**
     * 账号被停用时立即吊销其全部刷新令牌，下一次刷新即要求重新登录（spec §10.1 必测场景 9）。
     */
    private Account requireActiveAccount(Long accountId) {
        Account account = accountMapper.selectById(accountId);
        if (account == null) {
            throw BizException.of(ErrorCode.UNAUTHENTICATED);
        }
        if (STATUS_DISABLED.equals(account.getStatus())) {
            tokenService.revokeAllForAccount(accountId);
            throw BizException.of(ErrorCode.ACCOUNT_DISABLED);
        }
        return account;
    }

    private String defaultNickname(String phone) {
        return phone.length() >= 4 ? "用户" + phone.substring(phone.length() - 4) : "用户";
    }
}
