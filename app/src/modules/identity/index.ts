/**
 * identity 模块的公开出口。
 *
 * 负责账号身份的界面与纯逻辑：登录、注册、密码、短信频控、换手机号、邮箱、
 * 实名认证、资料、注销和头像裁剪。
 *
 * 会话、令牌安全存储和同意记录仍放在 `app/src/auth/`，它们是被多个模块共用的
 * 基础设施；本模块只依赖它们，不把它们搬进来。
 */
export { LoginScreen } from './screens/LoginScreen';
export { RegisterScreen } from './screens/RegisterScreen';
export { BindPhoneScreen } from './screens/BindPhoneScreen';
export { PasswordScreen } from './screens/PasswordScreen';
export { PasswordResetScreen } from './screens/PasswordResetScreen';
export { PhoneChangeScreen } from './screens/PhoneChangeScreen';
export { EmailBindScreen } from './screens/EmailBindScreen';
export { RealNameScreen } from './screens/RealNameScreen';
export { AccountDeletionScreen } from './screens/AccountDeletionScreen';
export { ProfileEditScreen } from './screens/ProfileEditScreen';
export { AvatarCropScreen } from './screens/AvatarCropScreen';

export { loginButtons } from './domain/loginForm';
export {
  PASSWORD_RULE,
  canSubmitPasswordLogin,
  passwordIssue,
  passwordsMatch,
  type LoginMode,
} from './domain/password';
export {
  SMS_COOLDOWN_SECONDS,
  nextCooldown,
  sendCodeLabel,
} from './domain/smsCooldown';
export {
  MAX_NICKNAME_LENGTH,
  displayName,
  maskPhone,
  normalizeNickname,
  validateNickname,
} from './domain/profile';
export {
  MAX_AVATAR_ZOOM,
  clampTransform,
  cropRect,
  initialTransform,
  renderedSize,
  scaleFromPinch,
  touchDistance,
  type CropRect,
  type CropTransform,
  type ImageSize,
} from './domain/avatarCrop';
