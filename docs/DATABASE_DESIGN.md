# Obsidian S3-Bridge 远程数据存储设计

## 数据库设计 (Supabase)

### 核心表结构

#### 1. 文件元数据表 (files)
```sql
CREATE TABLE files (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    vault_id UUID,
    file_name TEXT NOT NULL,
    original_name TEXT NOT NULL,
    file_size BIGINT NOT NULL,
    mime_type TEXT,
    file_hash TEXT NOT NULL, -- SHA256 hash
    storage_provider TEXT NOT NULL, -- 's3', 'r2', 'minio' 等
    storage_bucket TEXT NOT NULL,
    storage_key TEXT NOT NULL,
    public_url TEXT NOT NULL,
    thumbnail_url TEXT,
    width INTEGER, -- 图片尺寸
    height INTEGER, -- 图片尺寸
    duration INTEGER, -- 视频/音频时长
    metadata JSONB, -- 额外的元数据
    tags TEXT[], -- 文件标签
    description TEXT,
    upload_status TEXT DEFAULT 'pending', -- 'pending', 'uploading', 'completed', 'failed'
    upload_progress INTEGER DEFAULT 0,
    error_message TEXT,
    upload_started_at TIMESTAMPTZ,
    upload_completed_at TIMESTAMPTZ,
    last_accessed_at TIMESTAMPTZ,
    access_count INTEGER DEFAULT 0,
    is_deleted BOOLEAN DEFAULT FALSE,
    deleted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_files_user_id ON files(user_id);
CREATE INDEX idx_files_vault_id ON files(vault_id);
CREATE INDEX idx_files_storage_key ON files(storage_key);
CREATE INDEX idx_files_file_hash ON files(file_hash);
CREATE INDEX idx_files_upload_status ON files(upload_status);
CREATE INDEX idx_files_created_at ON files(created_at);
CREATE INDEX idx_files_tags ON files USING GIN(tags);
```

#### 2. 仓库配置表 (vaults)
```sql
CREATE TABLE vaults (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    vault_name TEXT NOT NULL,
    vault_path TEXT NOT NULL,
    device_id TEXT,
    last_sync_at TIMESTAMPTZ,
    sync_status TEXT DEFAULT 'active', -- 'active', 'inactive', 'error'
    settings JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_vaults_user_id ON vaults(user_id);
CREATE INDEX idx_vaults_device_id ON vaults(device_id);
```

#### 3. 上传配置表 (upload_configs)
```sql
CREATE TABLE upload_configs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    config_name TEXT NOT NULL,
    storage_provider TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    bucket TEXT NOT NULL,
    region TEXT,
    access_key_id TEXT,
    public_url TEXT,
    object_key_prefix TEXT DEFAULT '',
    size_limit INTEGER DEFAULT 10, -- MB
    cache_control TEXT DEFAULT 'max-age=31536000, public',
    is_default BOOLEAN DEFAULT FALSE,
    is_active BOOLEAN DEFAULT TRUE,
    settings JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_upload_configs_user_id ON upload_configs(user_id);
CREATE INDEX idx_upload_configs_is_default ON upload_configs(is_default);
```

#### 4. 使用统计表 (usage_stats)
```sql
CREATE TABLE usage_stats (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    vault_id UUID REFERENCES vaults(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    total_uploads INTEGER DEFAULT 0,
    total_size BIGINT DEFAULT 0,
    successful_uploads INTEGER DEFAULT 0,
    failed_uploads INTEGER DEFAULT 0,
    unique_files INTEGER DEFAULT 0,
    storage_costs DECIMAL(10, 6) DEFAULT 0,
    bandwidth_used BIGINT DEFAULT 0,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_usage_stats_user_id ON usage_stats(user_id);
CREATE INDEX idx_usage_stats_date ON usage_stats(date);
CREATE UNIQUE INDEX idx_usage_stats_user_date ON usage_stats(user_id, date);
```

#### 5. 文件关联表 (file_relations)
```sql
CREATE TABLE file_relations (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    source_file_id UUID REFERENCES files(id) ON DELETE CASCADE,
    target_file_id UUID REFERENCES files(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL, -- 'thumbnail', 'compressed', 'derived', 'related'
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_file_relations_user_id ON file_relations(user_id);
CREATE INDEX idx_file_relations_source_file_id ON file_relations(source_file_id);
CREATE INDEX idx_file_relations_target_file_id ON file_relations(target_file_id);
```

#### 6. 同步日志表 (sync_logs)
```sql
CREATE TABLE sync_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    vault_id UUID REFERENCES vaults(id) ON DELETE CASCADE,
    action TEXT NOT NULL, -- 'upload', 'delete', 'update', 'sync'
    entity_type TEXT NOT NULL, -- 'file', 'config', 'vault'
    entity_id UUID NOT NULL,
    old_data JSONB,
    new_data JSONB,
    status TEXT DEFAULT 'pending', -- 'pending', 'completed', 'failed'
    error_message TEXT,
    device_id TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 索引
CREATE INDEX idx_sync_logs_user_id ON sync_logs(user_id);
CREATE INDEX idx_sync_logs_vault_id ON sync_logs(vault_id);
CREATE INDEX idx_sync_logs_action ON sync_logs(action);
CREATE INDEX idx_sync_logs_created_at ON sync_logs(created_at);
```

### Realtime 订阅设置

```sql
-- 启用表的实时功能
ALTER PUBLICATION supabase_realtime ADD TABLE files;
ALTER PUBLICATION supabase_realtime ADD TABLE vaults;
ALTER PUBLICATION supabase_realtime ADD TABLE upload_configs;
ALTER PUBLICATION supabase_realtime ADD TABLE sync_logs;
```

### Row Level Security (RLS) 策略

```sql
-- 文件表安全策略
ALTER TABLE files ENABLE ROW LEVEL SECURITY;

-- 用户只能访问自己的文件
CREATE POLICY "Users can view own files" ON files
    FOR SELECT USING (auth.uid() = user_id);

-- 用户只能插入自己的文件
CREATE POLICY "Users can insert own files" ON files
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 用户只能更新自己的文件
CREATE POLICY "Users can update own files" ON files
    FOR UPDATE USING (auth.uid() = user_id);

-- 用户只能软删除自己的文件
CREATE POLICY "Users can delete own files" ON files
    FOR DELETE USING (auth.uid() = user_id);

-- 仓库表安全策略
ALTER TABLE vaults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own vaults" ON vaults
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own vaults" ON vaults
    FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 上传配置表安全策略
ALTER TABLE upload_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own upload configs" ON upload_configs
    FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own upload configs" ON upload_configs
    FOR INSERT WITH CHECK (auth.uid() = user_id);
```

### 函数和触发器

```sql
-- 自动更新 updated_at 字段
CREATE OR REPLACE FUNCTION handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 为需要的表添加触发器
CREATE TRIGGER handle_files_updated_at
    BEFORE UPDATE ON files
    FOR EACH ROW
    EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER handle_vaults_updated_at
    BEFORE UPDATE ON vaults
    FOR EACH ROW
    EXECUTE FUNCTION handle_updated_at();

CREATE TRIGGER handle_upload_configs_updated_at
    BEFORE UPDATE ON upload_configs
    FOR EACH ROW
    EXECUTE FUNCTION handle_updated_at();

-- 文件删除时的软删除触发器
CREATE OR REPLACE FUNCTION soft_delete_file()
RETURNS TRIGGER AS $$
BEGIN
    NEW.is_deleted = TRUE;
    NEW.deleted_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER soft_delete_file_trigger
    BEFORE DELETE ON files
    FOR EACH ROW
    EXECUTE FUNCTION soft_delete_file();

-- 自动记录使用统计
CREATE OR REPLACE FUNCTION update_usage_stats()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO usage_stats (user_id, vault_id, date, total_uploads, total_size, successful_uploads)
    VALUES (
        NEW.user_id,
        NEW.vault_id,
        CURRENT_DATE,
        1,
        NEW.file_size,
        CASE WHEN NEW.upload_status = 'completed' THEN 1 ELSE 0 END
    )
    ON CONFLICT (user_id, date) DO UPDATE SET
        total_uploads = usage_stats.total_uploads + 1,
        total_size = usage_stats.total_size + NEW.file_size,
        successful_uploads = usage_stats.successful_uploads + 
            CASE WHEN NEW.upload_status = 'completed' THEN 1 ELSE 0 END;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_usage_stats_trigger
    AFTER INSERT OR UPDATE ON files
    FOR EACH ROW
    WHEN (NEW.upload_status = 'completed')
    EXECUTE FUNCTION update_usage_stats();
```