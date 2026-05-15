# 实施检查清单（已完成 ✅）

## 第1层：AI Prompt 重写 (smart-extractor.ts)
- [x] 1. 角色设定 + 价值标准具体化（完整吸收参考提示词）
- [x] 2. 增加"意义完整性"要求（固定短语整体保留）
- [x] 3. 增加"含中文配对"规则（外-外语对排除）
- [x] 4. source_lang 改为"概念首倡语言"
- [x] 5. 新增 source_confidence 字段

## 第2层：后端过滤 (bilingual-extractor.ts)
- [x] 6. 引入 isValidLanguagePair 校验函数
- [x] 7. alignTermPairs() 前过滤：只处理含 zh 的语言对
- [x] 8. 检测"外-外"分布时降级返回中文术语
- [x] 9. 最终输出前再次过滤非含中文语对

## 第3层：规则抽取优化 (index.ts extractChineseTerms)
- [x] 10. UI噪声预处理（小中大分享到、字体、摘要等）
- [x] 11. 最大术语长度限制 ≤12 字（防止完整句子）
- [x] 12. 首词黑名单（动词/介词开头过滤）
- [x] 13. 模式C正则优化（{3,5}? + 负向后顾断言(?<![的与及或在])）
- [x] 14. 评分体系优化（5-6字最高分9分、结构词加分2分）

## 第4层：验证
- [x] 15. 三层修改全部确认落地（smart-extractor.ts / bilingual-extractor.ts / index.ts）
- [x] 16. 编译验证通过（仅预设ts6133未使用变量警告）
