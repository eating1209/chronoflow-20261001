package com.chronoflow.auth.mapper;

import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

/** 脱敏训练样本的读写。写入时再检查一次 opt-in，避免关闭开关与请求并发时漏进新样本。 */
@Mapper
public interface TrainingSampleMapper {

    @Insert("""
            INSERT INTO training_sample
                (identity_id, source, redacted_text, parsed_json, sample_version, expires_at)
            SELECT #{identityId}, #{source}, #{redactedText}, CAST(#{parsedJson} AS jsonb), 1,
                   now() + (#{retentionDays} * INTERVAL '1 day')
             WHERE EXISTS (
                   SELECT 1 FROM identity
                    WHERE id = #{identityId} AND training_data_opt_in = TRUE
             )
            """)
    int insertIfOptedIn(@Param("identityId") Long identityId,
                        @Param("source") String source,
                        @Param("redactedText") String redactedText,
                        @Param("parsedJson") String parsedJson,
                        @Param("retentionDays") int retentionDays);

    @Delete("DELETE FROM training_sample WHERE identity_id = #{identityId}")
    int deleteForIdentity(@Param("identityId") Long identityId);

    @Delete("DELETE FROM training_sample WHERE expires_at <= now()")
    int deleteExpired();
}
