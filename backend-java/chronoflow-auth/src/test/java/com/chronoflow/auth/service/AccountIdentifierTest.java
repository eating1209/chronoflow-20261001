package com.chronoflow.auth.service;

import com.chronoflow.common.exception.BizException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 账号识别（手机号 / 邮箱）的护栏。
 *
 * <p>与前端 `app/test/accountIdentifier.test.ts` **一一对应**：
 * 两边规则必须一致，否则会出现「前端放行、后端拒绝」——
 * 用户明明按提示填对了，还是登不上，而且看不出原因。
 */
class AccountIdentifierTest {

    @Test
    void phoneNumber() {
        AccountIdentifier id = AccountIdentifier.parse("13900001234");
        assertThat(id.type()).isEqualTo(AccountIdentifier.Type.PHONE);
        assertThat(id.isPhone()).isTrue();
        assertThat(id.value()).isEqualTo("13900001234");
    }

    @Test
    void phoneWithSurroundingSpacesIsTrimmed() {
        assertThat(AccountIdentifier.parse("  13900001234  ").value()).isEqualTo("13900001234");
    }

    @Test
    void email() {
        AccountIdentifier id = AccountIdentifier.parse("Zhang.San+work@Company.com.CN");
        assertThat(id.type()).isEqualTo(AccountIdentifier.Type.EMAIL);
        assertThat(id.isPhone()).isFalse();
        // 邮箱统一小写：Foo@Bar.com 与 foo@bar.com 必须命中同一个账号
        assertThat(id.value()).isEqualTo("zhang.san+work@company.com.cn");
    }

    @Test
    void emailWithNumericLocalPartIsNotMistakenForPhone() {
        // 关键用例：本地部分是 11 位数字，但含 @，必须先按邮箱判
        AccountIdentifier id = AccountIdentifier.parse("13900001234@qq.com");
        assertThat(id.type()).isEqualTo(AccountIdentifier.Type.EMAIL);
    }

    @Test
    void malformedInputRejected() {
        assertInvalid("");
        assertInvalid("   ");
        assertInvalid("1390000123");      // 10 位
        assertInvalid("23900001234");     // 不是 1 开头
        assertInvalid("a@b");             // 缺顶级域
        assertInvalid("@b.com");          // 缺本地部分
        assertInvalid("随便写点什么");
    }

    @Test
    void maskHidesMostOfTheAccount() {
        assertThat(AccountIdentifier.parse("13900001234").masked()).isEqualTo("139****1234");
        assertThat(AccountIdentifier.parse("zhangsan@example.com").masked()).isEqualTo("z***@example.com");
    }

    private void assertInvalid(String raw) {
        assertThatThrownBy(() -> AccountIdentifier.parse(raw))
                .isInstanceOf(BizException.class);
    }
}
