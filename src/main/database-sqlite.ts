// SQLite数据库模块 - 替换内存数据库
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

const DB_FILENAME = 'term-manager.db';
let db: Database.Database;
let dbFilePath = '';

function getDataFilePath(userDataPath?: string) {
  if (userDataPath) {
    return path.join(userDataPath, DB_FILENAME);
  }
  // 生产环境使用用户数据目录
  return path.join(app.getPath('userData'), DB_FILENAME);
}

// 创建完整的数据表结构
function createTables() {
  db.exec(`
    -- 领域分类表
    CREATE TABLE IF NOT EXISTS domains (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES domains(id) ON DELETE CASCADE
    );

    -- 术语主表
    CREATE TABLE IF NOT EXISTS terms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_lang TEXT NOT NULL CHECK (source_lang IN ('zh', 'en')),
      term_text TEXT NOT NULL,
      abbreviation TEXT,
      target_lang TEXT CHECK (target_lang IN ('zh', 'en', '')),
      target_text TEXT,
      domain_id INTEGER,
      description TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (domain_id) REFERENCES domains(id) ON DELETE SET NULL
    );

    -- 创建索引以提高查询性能
    CREATE INDEX IF NOT EXISTS idx_terms_source_lang ON terms(source_lang);
    CREATE INDEX IF NOT EXISTS idx_terms_term_text ON terms(term_text);
    CREATE INDEX IF NOT EXISTS idx_terms_target_text ON terms(target_text);
    CREATE INDEX IF NOT EXISTS idx_terms_domain_id ON terms(domain_id);
    CREATE INDEX IF NOT EXISTS idx_terms_updated_at ON terms(updated_at);

    -- 术语关系表 (同义词、近义词、一词多义)
    CREATE TABLE IF NOT EXISTS term_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term_id INTEGER NOT NULL,
      relation_type TEXT NOT NULL CHECK (relation_type IN ('synonym', 'near_synonym', 'polysemy', 'antonym', 'related')),
      related_term_id INTEGER NOT NULL,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE,
      FOREIGN KEY (related_term_id) REFERENCES terms(id) ON DELETE CASCADE,
      UNIQUE(term_id, relation_type, related_term_id)
    );

    -- 创建关系索引
    CREATE INDEX IF NOT EXISTS idx_term_relations_term_id ON term_relations(term_id);
    CREATE INDEX IF NOT EXISTS idx_term_relations_related_term_id ON term_relations(related_term_id);

    -- 术语来源表 (权威性标注)
    CREATE TABLE IF NOT EXISTS term_sources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term_id INTEGER NOT NULL,
      source_type TEXT NOT NULL CHECK (source_type IN ('web_extract', 'plain_text', 'high_quality', 'official', 'manual', 'ai_extract')),
      source_detail TEXT,
      credibility_score INTEGER DEFAULT 1 CHECK (credibility_score BETWEEN 1 AND 5),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (term_id) REFERENCES terms(id) ON DELETE CASCADE
    );

    -- 创建来源索引
    CREATE INDEX IF NOT EXISTS idx_term_sources_term_id ON term_sources(term_id);
    CREATE INDEX IF NOT EXISTS idx_term_sources_source_type ON term_sources(source_type);

    -- 提取记录表
    CREATE TABLE IF NOT EXISTS extraction_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_name TEXT,
      source_type TEXT CHECK (source_type IN ('file', 'text', 'url')),
      source_path TEXT,
      language TEXT CHECK (language IN ('auto', 'zh', 'en')),
      item_count INTEGER DEFAULT 0,
      use_ai BOOLEAN DEFAULT FALSE,
      note TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 设置表
    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- 插入默认设置
    INSERT OR IGNORE INTO settings (key, value) VALUES
      ('ai_api_key', ''),
      ('ai_endpoint', 'https://api.openai.com/v1/chat/completions'),
      ('ai_model', 'gpt-4o-mini'),
      ('data_path', ''),
      ('default_language', 'auto'),
      ('min_term_frequency', '2'),
      ('min_term_length', '2');
  `);
}

// 数据迁移函数：从JSON文件迁移到SQLite
function migrateFromJSON(jsonFilePath: string) {
  if (!fs.existsSync(jsonFilePath)) {
    console.log('No JSON database file found for migration');
    return;
  }

  try {
    const content = fs.readFileSync(jsonFilePath, 'utf-8');
    const memoryDB = JSON.parse(content);
    
    const migrateStmt = db.prepare('BEGIN TRANSACTION');
    migrateStmt.run();
    
    try {
      // 迁移领域
      if (memoryDB.domains && Array.isArray(memoryDB.domains)) {
        const domainStmt = db.prepare(`
          INSERT OR REPLACE INTO domains (id, name, parent_id, description, created_at)
          VALUES (?, ?, ?, ?, ?)
        `);
        for (const domain of memoryDB.domains) {
          if (domain.id && domain.name) {
            domainStmt.run(
              domain.id,
              domain.name,
              domain.parent_id || null,
              domain.description || null,
              domain.created_at || new Date().toISOString()
            );
          }
        }
      }

      // 迁移术语
      if (memoryDB.terms && Array.isArray(memoryDB.terms)) {
        const termStmt = db.prepare(`
          INSERT OR REPLACE INTO terms (
            id, source_lang, term_text, abbreviation, target_lang, target_text,
            domain_id, description, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const term of memoryDB.terms) {
          if (term.id && term.term_text) {
            termStmt.run(
              term.id,
              term.source_lang || 'zh',
              term.term_text,
              term.abbreviation || null,
              term.target_lang || null,
              term.target_text || null,
              term.domain_id || null,
              term.description || null,
              term.created_at || new Date().toISOString(),
              term.updated_at || new Date().toISOString()
            );
          }
        }
      }

      // 迁移术语关系
      if (memoryDB.termRelations && Array.isArray(memoryDB.termRelations)) {
        const relationStmt = db.prepare(`
          INSERT OR REPLACE INTO term_relations (
            id, term_id, relation_type, related_term_id, note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const rel of memoryDB.termRelations) {
          if (rel.id && rel.term_id && rel.related_term_id) {
            relationStmt.run(
              rel.id,
              rel.term_id,
              rel.relation_type || 'related',
              rel.related_term_id,
              rel.note || null,
              rel.created_at || new Date().toISOString()
            );
          }
        }
      }

      // 迁移术语来源
      if (memoryDB.termSources && Array.isArray(memoryDB.termSources)) {
        const sourceStmt = db.prepare(`
          INSERT OR REPLACE INTO term_sources (
            id, term_id, source_type, source_detail, credibility_score, created_at
          ) VALUES (?, ?, ?, ?, ?, ?)
        `);
        for (const source of memoryDB.termSources) {
          if (source.id && source.term_id) {
            sourceStmt.run(
              source.id,
              source.term_id,
              source.source_type || 'plain_text',
              source.source_detail || null,
              source.credibility_score || 1,
              source.created_at || new Date().toISOString()
            );
          }
        }
      }

      // 迁移提取记录
      if (memoryDB.extractionJobs && Array.isArray(memoryDB.extractionJobs)) {
        const jobStmt = db.prepare(`
          INSERT OR REPLACE INTO extraction_jobs (
            id, job_name, source_type, source_path, language, item_count, use_ai, note, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        for (const job of memoryDB.extractionJobs) {
          if (job.id) {
            jobStmt.run(
              job.id,
              job.job_name || null,
              job.source_type || 'file',
              job.source_path || null,
              job.language || 'auto',
              job.item_count || 0,
              job.use_ai || false,
              job.note || null,
              job.created_at || new Date().toISOString()
            );
          }
        }
      }

      // 迁移设置
      if (memoryDB.settings && Array.isArray(memoryDB.settings) && memoryDB.settings[0]) {
        const settings = memoryDB.settings[0];
        const settingKeys = ['apiKey', 'endpoint', 'promptTemplate', 'dataPath'];
        for (const [key, value] of Object.entries(settings)) {
          if (value !== undefined) {
            const stmt = db.prepare(`
              INSERT OR REPLACE INTO settings (key, value, updated_at)
              VALUES (?, ?, ?)
            `);
            stmt.run(key, String(value), new Date().toISOString());
          }
        }
      }

      db.prepare('COMMIT').run();
      console.log(`Migration completed successfully from ${jsonFilePath}`);
      
      // 备份原JSON文件
      const backupPath = jsonFilePath + '.backup-' + new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(jsonFilePath, backupPath);
      console.log(`Original JSON file backed up to: ${backupPath}`);
      
    } catch (error) {
      db.prepare('ROLLBACK').run();
      console.error('Migration failed, rolled back:', error);
      throw error;
    }
  } catch (error) {
    console.error('Migration from JSON failed:', error);
  }
}

// 初始化SQLite数据库
export function initDatabase(dataPath?: string) {
  const userDataPath = dataPath || process.env.ELECTRON_USER_DATA || app.getPath('userData');
  dbFilePath = getDataFilePath(userDataPath);
  
  console.log(`Initializing SQLite database at: ${dbFilePath}`);
  
  // 创建目录（如果不存在）
  const dbDir = path.dirname(dbFilePath);
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  // 打开数据库连接
  db = new Database(dbFilePath);
  
  // 启用WAL模式以提高并发性能
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  
  // 创建表结构
  createTables();
  
  // 尝试从JSON文件迁移数据
  const jsonFilePath = path.join(dbDir, 'term-manager-db.json');
  if (fs.existsSync(jsonFilePath)) {
    console.log('Found JSON database file, attempting migration...');
    migrateFromJSON(jsonFilePath);
  }
  
  console.log('SQLite database initialized successfully');
  return true;
}

export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

// DAO: 获取设置
export function getSettings() {
  if (!db) {
    console.warn('Database not initialized, returning empty settings');
    return {};
  }
  const stmt = db.prepare('SELECT key, value FROM settings');
  const rows = stmt.all() as Array<{ key: string; value: string }>;
  const settings: Record<string, string> = {};
  rows.forEach(row => {
    settings[row.key] = row.value;
  });
  return settings;
}

export function setSettings(settings: Record<string, any>) {
  const transaction = db.transaction((settingsObj: Record<string, any>) => {
    for (const [key, value] of Object.entries(settingsObj)) {
      if (value !== undefined) {
        const stmt = db.prepare(`
          INSERT OR REPLACE INTO settings (key, value, updated_at)
          VALUES (?, ?, ?)
        `);
        stmt.run(key, String(value), new Date().toISOString());
      }
    }
  });
  
  transaction(settings);
  return getSettings();
}

// DAO: 术语操作
export function getTerms(params?: {
  page?: number;
  pageSize?: number;
  domain?: number;
  keyword?: string;
  sourceLang?: string;
  targetLang?: string;
}) {
  const page = params?.page || 1;
  const pageSize = params?.pageSize || 50;
  const offset = (page - 1) * pageSize;
  
  let whereClauses: string[] = ['1=1'];
  const queryParams: any[] = [];
  
  if (params?.domain) {
    // 递归获取子领域ID
    const domainIds = getDomainSubtreeIds(params.domain);
    if (domainIds.length > 0) {
      whereClauses.push(`domain_id IN (${domainIds.map(() => '?').join(',')})`);
      queryParams.push(...domainIds);
    }
  }
  
  if (params?.sourceLang) {
    whereClauses.push('source_lang = ?');
    queryParams.push(params.sourceLang);
  }
  
  if (params?.targetLang) {
    whereClauses.push('target_lang = ?');
    queryParams.push(params.targetLang);
  }
  
  if (params?.keyword) {
    whereClauses.push('(term_text LIKE ? OR target_text LIKE ? OR description LIKE ?)');
    const keyword = `%${params.keyword}%`;
    queryParams.push(keyword, keyword, keyword);
  }
  
  const whereClause = whereClauses.join(' AND ');
  
  // 获取总数
  const countStmt = db.prepare(`SELECT COUNT(*) as total FROM terms WHERE ${whereClause}`);
  const totalResult = countStmt.get(...queryParams) as { total: number };
  const total = totalResult.total;
  
  // 获取数据
  const queryStmt = db.prepare(`
    SELECT * FROM terms 
    WHERE ${whereClause}
    ORDER BY updated_at DESC 
    LIMIT ? OFFSET ?
  `);
  
  const rows = queryStmt.all(...queryParams, pageSize, offset);
  
  return { rows, total };
}

// 辅助函数：获取领域子树的所有ID
function getDomainSubtreeIds(domainId: number): number[] {
  const ids: number[] = [domainId];
  const getChildrenStmt = db.prepare('SELECT id FROM domains WHERE parent_id = ?');
  const children = getChildrenStmt.all(domainId) as Array<{ id: number }>;
  
  for (const child of children) {
    ids.push(...getDomainSubtreeIds(child.id));
  }
  
  return ids;
}

export function getTermById(id: number) {
  const stmt = db.prepare('SELECT * FROM terms WHERE id = ?');
  return stmt.get(id);
}

export function addTerm(term: {
  source_lang: string;
  term_text: string;
  target_lang?: string;
  target_text?: string;
  domain_id?: number;
  description?: string;
  abbreviation?: string;
}) {
  const stmt = db.prepare(`
    INSERT INTO terms (
      source_lang, term_text, abbreviation, target_lang, target_text,
      domain_id, description, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const now = new Date().toISOString();
  const info = stmt.run(
    term.source_lang,
    term.term_text,
    term.abbreviation || null,
    term.target_lang || null,
    term.target_text || null,
    term.domain_id || null,
    term.description || null,
    now,
    now
  );
  
  return info.lastInsertRowid as number;
}

export function updateTerm(
  id: number,
  updates: Partial<{
    term_text: string;
    target_text: string;
    abbreviation: string;
    description: string;
    domain_id: number;
  }>
) {
  const fields = Object.keys(updates);
  if (fields.length === 0) return null;
  
  const setClause = fields.map(field => `${field} = ?`).join(', ');
  const values = fields.map(field => updates[field as keyof typeof updates]);
  values.push(id, new Date().toISOString());
  
  const stmt = db.prepare(`
    UPDATE terms 
    SET ${setClause}, updated_at = ? 
    WHERE id = ?
  `);
  
  stmt.run(...values);
  
  return getTermById(id);
}

export function deleteTerm(id: number) {
  const stmt = db.prepare('DELETE FROM terms WHERE id = ?');
  return stmt.run(id);
}

// DAO: 领域操作
export function getDomains() {
  const stmt = db.prepare('SELECT * FROM domains ORDER BY parent_id, name');
  return stmt.all();
}

export function addDomain(domain: { name: string; parent_id?: number; description?: string }) {
  const stmt = db.prepare(`
    INSERT INTO domains (name, parent_id, description, created_at)
    VALUES (?, ?, ?, ?)
  `);
  
  const info = stmt.run(
    domain.name,
    domain.parent_id || null,
    domain.description || null,
    new Date().toISOString()
  );
  
  return info.lastInsertRowid as number;
}

export function deleteDomain(id: number) {
  const stmt = db.prepare('DELETE FROM domains WHERE id = ?');
  return stmt.run(id);
}

// DAO: 术语关系操作
export function addTermRelation(relation: {
  term_id: number;
  relation_type: string;
  related_term_id: number;
  note?: string;
}) {
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO term_relations (term_id, relation_type, related_term_id, note, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const info = stmt.run(
    relation.term_id,
    relation.relation_type,
    relation.related_term_id,
    relation.note || null,
    new Date().toISOString()
  );
  
  return info.lastInsertRowid as number;
}

export function getTermRelations(termId: number) {
  // 联合查询：正向关系（本术语指向其它术语） + 反向关系（其它术语指向本术语）
  const stmt = db.prepare(`
    SELECT tr.*, t.term_text, t.source_lang, t.target_text, t.target_lang,
           'forward' AS direction
    FROM term_relations tr
    JOIN terms t ON tr.related_term_id = t.id
    WHERE tr.term_id = ?
    UNION ALL
    SELECT tr.*, t.term_text, t.source_lang, t.target_text, t.target_lang,
           'reverse' AS direction
    FROM term_relations tr
    JOIN terms t ON tr.term_id = t.id
    WHERE tr.related_term_id = ? AND tr.term_id != ?
    ORDER BY created_at DESC
  `);

  return stmt.all(termId, termId, termId);
}

export function getTermRelationById(id: number) {
  const stmt = db.prepare('SELECT * FROM term_relations WHERE id = ?');
  return stmt.get(id);
}

export function deleteTermRelation(id: number) {
  const stmt = db.prepare('DELETE FROM term_relations WHERE id = ?');
  return stmt.run(id);
}

export function deleteTermRelationByPair(term_id: number, relation_type: string, related_term_id: number) {
  // 删除正向关系
  const forwardStmt = db.prepare('DELETE FROM term_relations WHERE term_id = ? AND relation_type = ? AND related_term_id = ?');
  const forwardResult = forwardStmt.run(term_id, relation_type, related_term_id);
  // 同时删除可能存在的反向关系
  const reverseStmt = db.prepare('DELETE FROM term_relations WHERE term_id = ? AND relation_type = ? AND related_term_id = ?');
  const reverseResult = reverseStmt.run(related_term_id, relation_type, term_id);
  return {
    changes: (forwardResult.changes || 0) + (reverseResult.changes || 0)
  };
}

// DAO: 术语来源操作
export function addTermSource(source: {
  term_id: number;
  source_type: string;
  source_detail?: string;
  credibility_score?: number;
}) {
  const stmt = db.prepare(`
    INSERT INTO term_sources (term_id, source_type, source_detail, credibility_score, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  
  const info = stmt.run(
    source.term_id,
    source.source_type,
    source.source_detail || null,
    source.credibility_score || 1,
    new Date().toISOString()
  );
  
  return info.lastInsertRowid as number;
}

export function getTermSources(termId: number) {
  const stmt = db.prepare(`
    SELECT * FROM term_sources 
    WHERE term_id = ?
    ORDER BY created_at DESC
  `);
  
  return stmt.all(termId);
}

// DAO: 提取记录操作
export function getExtractionJobs() {
  const stmt = db.prepare('SELECT * FROM extraction_jobs ORDER BY created_at DESC');
  return stmt.all();
}

export function addExtractionJob(job: {
  source_type: string;
  source_path?: string;
  language: string;
  item_count: number;
  note?: string;
}) {
  const stmt = db.prepare(`
    INSERT INTO extraction_jobs (source_type, source_path, language, item_count, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  
  const info = stmt.run(
    job.source_type,
    job.source_path || null,
    job.language,
    job.item_count,
    job.note || null,
    new Date().toISOString()
  );
  
  return info.lastInsertRowid as number;
}

export function deleteExtractionJob(id: number) {
  const stmt = db.prepare('DELETE FROM extraction_jobs WHERE id = ?');
  return stmt.run(id);
}

// 数据库备份函数
export function backupDatabase(backupPath?: string) {
  if (!dbFilePath || !fs.existsSync(dbFilePath)) {
    throw new Error('Database file not found');
  }
  
  const backupDir = backupPath || path.join(path.dirname(dbFilePath), 'backups');
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }
  
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = path.join(backupDir, `term-manager-backup-${timestamp}.db`);
  
  fs.copyFileSync(dbFilePath, backupFile);
  
  // 清理旧备份（保留最近10个）
  const files = fs.readdirSync(backupDir)
    .filter(f => f.startsWith('term-manager-backup-') && f.endsWith('.db'))
    .map(f => ({ name: f, path: path.join(backupDir, f), mtime: fs.statSync(path.join(backupDir, f)).mtime }))
    .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
  
  for (let i = 10; i < files.length; i++) {
    fs.unlinkSync(files[i].path);
  }
  
  return backupFile;
}

// 数据库维护函数
export function vacuumDatabase() {
  db.exec('VACUUM');
  console.log('Database vacuum completed');
}

// 导出数据库到JSON（用于调试）
export function exportToJson(outputPath: string) {
  const result = {
    domains: getDomains(),
    terms: getTerms({ page: 1, pageSize: 1000000 }).rows,
    termRelations: getAllTermRelations(),
    termSources: getAllTermSources(),
    extractionJobs: getExtractionJobs(),
    settings: getSettings()
  };
  
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  return outputPath;
}

// 获取所有关系（用于导出）
function getAllTermRelations() {
  const stmt = db.prepare(`
    SELECT tr.*, t1.term_text as term_text, t2.term_text as related_term_text
    FROM term_relations tr
    JOIN terms t1 ON tr.term_id = t1.id
    JOIN terms t2 ON tr.related_term_id = t2.id
    ORDER BY tr.created_at DESC
  `);
  
  return stmt.all();
}

// 获取所有来源（用于导出）
function getAllTermSources() {
  const stmt = db.prepare(`
    SELECT ts.*, t.term_text
    FROM term_sources ts
    JOIN terms t ON ts.term_id = t.id
    ORDER BY ts.created_at DESC
  `);
  
  return stmt.all();
}