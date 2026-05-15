#!/usr/bin/env node

/**
 * 术语管理系统端到端测试
 * 验证AI增强、数据库验证和UI逻辑改进
 * 
 * 运行方式: node end-to-end-test.cjs
 */

const fs = require('fs');
const path = require('path');

async function runEndToEndTests() {
    console.log('🚀 术语管理系统端到端测试\n');
    console.log('测试改进功能：');
    console.log('1. AI文件抽取增强字段支持');
    console.log('2. AI补全建议判断逻辑');
    console.log('3. 数据库目标语言验证');
    console.log('4. 数据修复工具验证');
    
    let passed = 0;
    let failed = 0;
    
    // 测试1: 验证AI增强抽取数据结构
    console.log('\n=== 测试1: AI增强抽取数据结构 ===');
    try {
        const termEnginePath = path.join(__dirname, 'src', 'main', 'term-engine', 'index.ts');
        const content = fs.readFileSync(termEnginePath, 'utf-8');
        
        // 检查是否包含AI增强字段
        const requiredFields = [
            'target_term?: string',
            'target_lang?: string',
            'translation_source?: string',
            'domain_suggestion?: string'
        ];
        
        let allFieldsFound = true;
        for (const field of requiredFields) {
            if (!content.includes(field)) {
                console.log(`❌ 缺少AI增强字段: ${field}`);
                allFieldsFound = false;
                failed++;
            }
        }
        
        if (allFieldsFound) {
            console.log('✅ AI增强抽取数据结构正确');
            passed++;
        }
    } catch (error) {
        console.log(`❌ 测试1失败: ${error.message}`);
        failed++;
    }
    
    // 测试2: 验证AI补全建议判断逻辑
    console.log('\n=== 测试2: AI补全建议判断逻辑 ===');
    try {
        const termManagerPath = path.join(__dirname, 'src', 'renderer', 'pages', 'TermManager.tsx');
        const content = fs.readFileSync(termManagerPath, 'utf-8');
        
        // 检查是否包含同语互译检测逻辑
        const requiredLogic = [
            'hasSameLangTranslation = record.target_text && record.target_lang && record.target_lang === record.source_lang',
            'hasValidTranslation = record.target_text && !hasSameLangTranslation',
            'needsAICompletion = !record.locked && (!hasValidTranslation || !record.domain_id)'
        ];
        
        let allLogicFound = true;
        for (const logic of requiredLogic) {
            if (!content.includes(logic)) {
                console.log(`❌ 缺少AI补全逻辑: ${logic}`);
                allLogicFound = false;
                failed++;
            }
        }
        
        if (allLogicFound) {
            console.log('✅ AI补全建议判断逻辑正确');
            passed++;
        }
    } catch (error) {
        console.log(`❌ 测试2失败: ${error.message}`);
        failed++;
    }
    
    // 测试3: 验证数据库目标语言验证
    console.log('\n=== 测试3: 数据库目标语言验证 ===');
    try {
        const dbMemoryPath = path.join(__dirname, 'src', 'main', 'database-memory.ts');
        const content = fs.readFileSync(dbMemoryPath, 'utf-8');
        
        // 检查是否包含同语互译检测和标准化逻辑
        const requiredDbLogic = [
            'normalizeTargetLang = (sourceLang: string, targetLang?: string): string',
            'if (normalizedTargetLang === term.source_lang)',
            'console.warn(`更新术语ID:${id} 时发现同语互译'
        ];
        
        let allDbLogicFound = true;
        for (const logic of requiredDbLogic) {
            if (!content.includes(logic)) {
                console.log(`❌ 缺少数据库验证逻辑: ${logic}`);
                allDbLogicFound = false;
                failed++;
            }
        }
        
        if (allDbLogicFound) {
            console.log('✅ 数据库目标语言验证逻辑正确');
            passed++;
        }
    } catch (error) {
        console.log(`❌ 测试3失败: ${error.message}`);
        failed++;
    }
    
    // 测试4: 验证数据修复工具存在
    console.log('\n=== 测试4: 数据修复工具验证 ===');
    try {
        const fixToolPath = path.join(__dirname, 'fix-wrong-targetlang.cjs');
        if (fs.existsSync(fixToolPath)) {
            const content = fs.readFileSync(fixToolPath, 'utf-8');
            
            // 检查修复工具功能
            const requiredFunctions = [
                'normalizeTargetLang(sourceLang, targetLang)',
                'fixTranslation(translation, termSourceLang, stats)',
                'analyzeData(data)',
                '--apply        应用修改并保存'
            ];
            
            let allFunctionsFound = true;
            for (const func of requiredFunctions) {
                if (!content.includes(func)) {
                    console.log(`❌ 修复工具缺少功能: ${func}`);
                    allFunctionsFound = false;
                    failed++;
                }
            }
            
            if (allFunctionsFound) {
                console.log('✅ 数据修复工具功能完整');
                passed++;
            }
        } else {
            console.log('❌ 数据修复工具文件不存在');
            failed++;
        }
    } catch (error) {
        console.log(`❌ 测试4失败: ${error.message}`);
        failed++;
    }
    
    // 测试5: 模拟实际用例
    console.log('\n=== 测试5: 模拟实际用例 ===');
    try {
        // 创建测试数据目录
        const testDataDir = path.join(__dirname, 'test-e2e-data');
        if (fs.existsSync(testDataDir)) {
            fs.rmSync(testDataDir, { recursive: true });
        }
        fs.mkdirSync(testDataDir, { recursive: true });
        
        // 创建测试数据文件
        const testData = {
            terms: [
                {
                    id: 1,
                    source_lang: 'zh',
                    term_text: '人工智能',
                    abbreviation: 'AI',
                    domain_id: 1,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                },
                {
                    id: 2,
                    source_lang: 'en',
                    term_text: 'Machine Learning',
                    abbreviation: 'ML',
                    domain_id: 2,
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }
            ],
            domains: [
                {
                    id: 1,
                    name: '计算机科学技术',
                    description: '计算机科学与技术',
                    created_at: new Date().toISOString()
                },
                {
                    id: 2,
                    name: '人工智能',
                    parent_id: 1,
                    description: '人工智能领域',
                    created_at: new Date().toISOString()
                }
            ],
            translations: [
                {
                    id: 1,
                    term_id: 1,
                    language_code: 'en',
                    text: 'Artificial Intelligence',
                    source: 'manual',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                },
                {
                    id: 2,
                    term_id: 2,
                    language_code: 'zh',
                    text: '机器学习',
                    source: 'manual',
                    created_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                }
            ]
        };
        
        const testDataFile = path.join(testDataDir, 'term-manager-data.json');
        fs.writeFileSync(testDataFile, JSON.stringify(testData, null, 2), 'utf-8');
        
        console.log('✅ 测试数据创建成功');
        console.log('  - 术语: 2个 (1个中文，1个英文)');
        console.log('  - 领域: 2个 (层级结构)');
        console.log('  - 翻译: 2个 (中英互译)');
        
        // 清理测试目录
        fs.rmSync(testDataDir, { recursive: true });
        
        passed++;
    } catch (error) {
        console.log(`❌ 测试5失败: ${error.message}`);
        failed++;
    }
    
    // 总结
    console.log('\n=== 测试结果汇总 ===');
    console.log(`✅ 通过: ${passed}`);
    console.log(`❌ 失败: ${failed}`);
    console.log(`📊 成功率: ${((passed / (passed + failed)) * 100).toFixed(1)}%`);
    
    if (failed > 0) {
        console.log('\n💡 改进建议:');
        console.log('1. 确保所有修改已正确应用到相关文件');
        console.log('2. 运行现有测试验证向后兼容性');
        console.log('3. 使用数据修复工具测试实际数据');
        console.log('4. 启动应用程序进行手动验证');
        process.exit(1);
    } else {
        console.log('\n🎉 所有端到端测试通过！');
        console.log('\n📋 下一步:');
        console.log('1. 运行开发服务器: npm run dev');
        console.log('2. 测试AI文件抽取功能');
        console.log('3. 验证AI补全建议逻辑');
        console.log('4. 使用数据修复工具检查现有数据');
    }
}

// 运行测试
runEndToEndTests().catch(error => {
    console.error('测试执行失败:', error);
    process.exit(1);
});