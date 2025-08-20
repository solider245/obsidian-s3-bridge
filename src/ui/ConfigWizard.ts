/**
 * 配置向导
 * 
 * 为新用户提供分步配置引导，支持常用服务商模板
 */

import { configManager } from '../config/ConfigurationManager'
import { validateUrl, validateAccessKey, validateSecretKey, validateBucketName, validateRegion } from '../config/validation'
import { errorHandler, withErrorHandling } from '../error/ErrorHandler'
import { Notice, Modal, Setting, App } from 'obsidian'

export interface ConfigTemplate {
  id: string
  name: string
  description: string
  icon: string
  endpoint: string
  region: string
  website: string
  documentation: string
  features: string[]
  pricing?: string
}

export interface WizardStep {
  id: string
  title: string
  description: string
  template?: ConfigTemplate
  validate?: (data: any) => { valid: boolean; errors: string[] }
  render?: (container: HTMLElement, data: any, updateData: (data: any) => void) => void
}

export interface WizardOptions {
  /** 是否显示欢迎页面 */
  showWelcome?: boolean
  /** 是否显示完成页面 */
  showComplete?: boolean
  /** 是否在完成后自动测试连接 */
  testOnComplete?: boolean
  /** 完成后的回调 */
  onComplete?: (config: any) => void
  /** 取消后的回调 */
  onCancel?: () => void
  /** 自定义步骤 */
  customSteps?: WizardStep[]
}

/**
 * 配置向导模态框
 */
export class ConfigWizardModal extends Modal {
  private options: Required<WizardOptions>
  private currentStep = 0
  private wizardData: any = {}
  private steps: WizardStep[] = []
  private wizardContentEl: HTMLElement
  private navigationEl: HTMLElement
  private stepContentEl: HTMLElement
  private progressEl: HTMLElement

  constructor(app: App, options: WizardOptions = {}) {
    super(app)
    
    this.options = {
      showWelcome: true,
      showComplete: true,
      testOnComplete: true,
      onComplete: () => {},
      onCancel: () => {},
      customSteps: [],
      ...options
    }
    
    this.initializeSteps()
  }

  onOpen() {
    const { contentEl } = this
    this.wizardContentEl = contentEl

    this.render()
  }

  onClose() {
    const { contentEl } = this
    contentEl.empty()
    this.options.onCancel()
  }

  /**
   * 初始化步骤
   */
  private initializeSteps(): void {
    const baseSteps: WizardStep[] = []

    // 欢迎页面
    if (this.options.showWelcome) {
      baseSteps.push({
        id: 'welcome',
        title: '欢迎使用 Obsidian S3-Bridge',
        description: '让我们来配置您的 S3 存储，只需几个简单步骤即可开始使用。'
      })
    }

    // 选择服务商
    baseSteps.push({
      id: 'provider',
      title: '选择存储服务商',
      description: '选择您要使用的云存储服务商，我们将为您提供相应的配置模板。'
    })

    // 基础配置
    baseSteps.push({
      id: 'basic',
      title: '基础配置',
      description: '输入您的存储服务访问凭据和基本信息。',
      validate: this.validateBasicConfig.bind(this)
    })

    // 高级配置
    baseSteps.push({
      id: 'advanced',
      title: '高级配置',
      description: '配置上传路径、文件大小限制等高级选项。',
      validate: this.validateAdvancedConfig.bind(this)
    })

    // 测试连接
    baseSteps.push({
      id: 'test',
      title: '测试连接',
      description: '测试您的配置是否正确，确保一切正常工作。'
    })

    // 完成页面
    if (this.options.showComplete) {
      baseSteps.push({
        id: 'complete',
        title: '配置完成！',
        description: '您的 S3-Bridge 插件已经配置完成，可以开始使用了。'
      })
    }

    this.steps = this.options.customSteps.length > 0 
      ? this.options.customSteps 
      : baseSteps
  }

  /**
   * 渲染向导
   */
  private render(): void {
    this.wizardContentEl.empty()
    this.wizardContentEl.addClass('s3-bridge-config-wizard')

    // 标题
    const titleEl = this.wizardContentEl.createEl('h2', { 
      text: 'S3-Bridge 配置向导',
      cls: 's3-bridge-wizard-title'
    })

    // 进度条
    this.progressEl = this.wizardContentEl.createDiv({ cls: 's3-bridge-wizard-progress' })
    this.renderProgress()

    // 步骤内容
    this.stepContentEl = this.wizardContentEl.createDiv({ cls: 's3-bridge-wizard-step-content' })
    this.renderStepContent()

    // 导航按钮
    this.navigationEl = this.wizardContentEl.createDiv({ cls: 's3-bridge-wizard-navigation' })
    this.renderNavigation()
  }

  /**
   * 渲染进度条
   */
  private renderProgress(): void {
    const progressContainer = this.progressEl.createDiv({ cls: 's3-bridge-wizard-progress-container' })
    
    // 步骤指示器
    const stepsIndicator = progressContainer.createDiv({ cls: 's3-bridge-wizard-steps' })
    
    this.steps.forEach((step, index) => {
      const stepIndicator = stepsIndicator.createDiv({ 
        cls: 's3-bridge-wizard-step-indicator'
      })
      
      if (index === this.currentStep) {
        stepIndicator.addClass('active')
      } else if (index < this.currentStep) {
        stepIndicator.addClass('completed')
      }
      
      stepIndicator.createDiv({ cls: 's3-bridge-wizard-step-number', text: (index + 1).toString() })
      stepIndicator.createDiv({ cls: 's3-bridge-wizard-step-title', text: step.title })
    })

    // 进度条
    const progressBar = progressContainer.createDiv({ cls: 's3-bridge-wizard-progress-bar' })
    const progressFill = progressBar.createDiv({ cls: 's3-bridge-wizard-progress-fill' })
    progressFill.style.width = `${(this.currentStep / (this.steps.length - 1)) * 100}%`
  }

  /**
   * 渲染步骤内容
   */
  private renderStepContent(): void {
    this.stepContentEl.empty()
    
    const step = this.steps[this.currentStep]
    
    // 步骤标题
    const stepTitle = this.stepContentEl.createEl('h3', { 
      text: step.title,
      cls: 's3-bridge-wizard-step-title'
    })
    
    // 步骤描述
    const stepDescription = this.stepContentEl.createEl('p', { 
      text: step.description,
      cls: 's3-bridge-wizard-step-description'
    })

    // 根据步骤ID渲染不同内容
    switch (step.id) {
      case 'welcome':
        this.renderWelcomeStep()
        break
      case 'provider':
        this.renderProviderStep()
        break
      case 'basic':
        this.renderBasicStep()
        break
      case 'advanced':
        this.renderAdvancedStep()
        break
      case 'test':
        this.renderTestStep()
        break
      case 'complete':
        this.renderCompleteStep()
        break
      default:
        if (step.render) {
          step.render(this.stepContentEl, this.wizardData, this.updateWizardData.bind(this))
        }
    }
  }

  /**
   * 渲染欢迎步骤
   */
  private renderWelcomeStep(): void {
    const welcomeContent = this.stepContentEl.createDiv({ cls: 's3-bridge-wizard-welcome' })
    
    welcomeContent.createEl('p', { 
      text: 'Obsidian S3-Bridge 插件可以帮助您自动上传图片和文件到 S3 兼容的云存储服务。'
    })
    
    welcomeContent.createEl('p', { 
      text: '支持的服务包括：'
    })
    
    const features = welcomeContent.createEl('ul', { cls: 's3-bridge-wizard-features' })
    const featureList = [
      'Amazon S3',
      'Cloudflare R2',
      'MinIO',
      'Backblaze B2',
      'DigitalOcean Spaces',
      'Wasabi'
    ]
    
    featureList.forEach(feature => {
      features.createEl('li', { text: feature })
    })
    
    welcomeContent.createEl('p', { 
      text: '配置过程大约需要 5-10 分钟，您需要准备好云存储服务的访问凭据。'
    })
  }

  /**
   * 渲染服务商选择步骤
   */
  private renderProviderStep(): void {
    const providerContent = this.stepContentEl.createDiv({ cls: 's3-bridge-wizard-providers' })
    
    const templates = this.getConfigTemplates()
    
    const templateGrid = providerContent.createDiv({ cls: 's3-bridge-wizard-template-grid' })
    
    templates.forEach(template => {
      const templateCard = templateGrid.createDiv({ 
        cls: 's3-bridge-wizard-template-card',
        attr: { 'data-template-id': template.id }
      })
      
      // 模板图标
      const templateIcon = templateCard.createDiv({ 
        cls: 's3-bridge-wizard-template-icon',
        text: template.icon
      })
      
      // 模板名称
      const templateName = templateCard.createDiv({ 
        cls: 's3-bridge-wizard-template-name',
        text: template.name
      })
      
      // 模板描述
      const templateDesc = templateCard.createDiv({ 
        cls: 's3-bridge-wizard-template-description',
        text: template.description
      })
      
      // 模板特性
      const templateFeatures = templateCard.createDiv({ 
        cls: 's3-bridge-wizard-template-features'
      })
      
      template.features.slice(0, 3).forEach(feature => {
        templateFeatures.createDiv({ 
          cls: 's3-bridge-wizard-template-feature',
          text: `• ${feature}`
        })
      })
      
      // 选择按钮
      const selectButton = templateCard.createEl('button', {
        text: '选择',
        cls: 's3-bridge-wizard-template-select'
      })
      
      selectButton.addEventListener('click', () => {
        this.selectTemplate(template)
      })
      
      // 高亮选中的模板
      if (this.wizardData.template?.id === template.id) {
        templateCard.addClass('selected')
      }
    })
  }

  /**
   * 渲染基础配置步骤
   */
  private renderBasicStep(): void {
    const basicContent = this.stepContentEl.createDiv({ cls: 's3-bridge-wizard-basic' })
    
    const form = basicContent.createDiv({ cls: 's3-bridge-wizard-form' })
    
    // 模板信息
    if (this.wizardData.template) {
      const templateInfo = form.createDiv({ cls: 's3-bridge-wizard-template-info' })
      templateInfo.createEl('h4', { text: `配置 ${this.wizardData.template.name}` })
      templateInfo.createEl('p', { 
        text: `端点: ${this.wizardData.template.endpoint}`,
        cls: 's3-bridge-wizard-template-endpoint'
      })
    }
    
    // Access Key
    new Setting(form)
      .setName('Access Key ID')
      .setDesc('您的云存储服务的访问密钥 ID')
      .addText(text => {
        text.setPlaceholder('AKIAIOSFODNN7EXAMPLE')
          .setValue(this.wizardData.accessKey || '')
          .onChange(value => {
            this.updateWizardData({ accessKey: value })
          })
      })
    
    // Secret Key
    new Setting(form)
      .setName('Secret Access Key')
      .setDesc('您的云存储服务的秘密访问密钥')
      .addText(text => {
        text.setPlaceholder('wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY')
          .setValue(this.wizardData.secretKey || '')
          .onChange(value => {
            this.updateWizardData({ secretKey: value })
          })
      })
    
    // Bucket Name
    new Setting(form)
      .setName('存储桶名称')
      .setDesc('您的存储桶名称（注意：名称必须全局唯一）')
      .addText(text => {
        text.setPlaceholder('my-unique-bucket-name')
          .setValue(this.wizardData.bucket || '')
          .onChange(value => {
            this.updateWizardData({ bucket: value })
          })
      })
    
    // Region
    new Setting(form)
      .setName('区域')
      .setDesc('您的存储桶所在的区域（留空表示自动检测）')
      .addText(text => {
        text.setPlaceholder('us-east-1')
          .setValue(this.wizardData.region || '')
          .onChange(value => {
            this.updateWizardData({ region: value })
          })
      })
    
    // 自定义端点（可选）
    if (!this.wizardData.template || this.wizardData.template.id === 'custom') {
      new Setting(form)
        .setName('自定义端点')
        .setDesc('如果您使用的是兼容 S3 的服务，请输入端点 URL')
        .addText(text => {
          text.setPlaceholder('https://s3.amazonaws.com')
            .setValue(this.wizardData.endpoint || '')
            .onChange(value => {
              this.updateWizardData({ endpoint: value })
            })
        })
    }
  }

  /**
   * 渲染高级配置步骤
   */
  private renderAdvancedStep(): void {
    const advancedContent = this.stepContentEl.createDiv({ cls: 's3-bridge-wizard-advanced' })
    
    const form = advancedContent.createDiv({ cls: 's3-bridge-wizard-form' })
    
    // 路径格式
    new Setting(form)
      .setName('文件路径格式')
      .setDesc('上传文件的存储路径格式')
      .addText(text => {
        text.setPlaceholder('assets/{year}/{month}/{day}/{filename}{ext}')
          .setValue(this.wizardData.pathFormat || 'assets/{year}/{month}/{day}/{filename}{ext}')
          .onChange(value => {
            this.updateWizardData({ pathFormat: value })
          })
      })
    
    // 文件名格式
    new Setting(form)
      .setName('文件名格式')
      .setDesc('上传文件的命名格式')
      .addText(text => {
        text.setPlaceholder('{timestamp}-{filename}{ext}')
          .setValue(this.wizardData.filenameFormat || '{timestamp}-{filename}{ext}')
          .onChange(value => {
            this.updateWizardData({ filenameFormat: value })
          })
      })
    
    // 文件大小限制
    new Setting(form)
      .setName('文件大小限制 (MB)')
      .setDesc('单个文件的最大大小限制')
      .addSlider(slider => {
        slider.setLimits(1, 100, 1)
          .setValue(this.wizardData.maxUploadMB || 5)
          .setDynamicTooltip()
          .onChange(value => {
            this.updateWizardData({ maxUploadMB: value })
          })
      })
    
    // 启用分片上传
    new Setting(form)
      .setName('启用分片上传')
      .setDesc('对大文件启用分片上传（提高大文件上传稳定性）')
      .addToggle(toggle => {
        toggle.setValue(this.wizardData.enableMultipart || false)
          .onChange(value => {
            this.updateWizardData({ enableMultipart: value })
          })
      })
  }

  /**
   * 渲染测试步骤
   */
  private renderTestStep(): void {
    const testContent = this.stepContentEl.createDiv({ cls: 's3-bridge-wizard-test' })
    
    const testInfo = testContent.createDiv({ cls: 's3-bridge-wizard-test-info' })
    testInfo.createEl('p', { text: '正在测试您的配置...' })
    
    const testButton = testContent.createEl('button', {
      text: '开始测试',
      cls: 's3-bridge-wizard-test-button mod-cta'
    })
    
    const testResult = testContent.createDiv({ cls: 's3-bridge-wizard-test-result' })
    
    testButton.addEventListener('click', async () => {
      testButton.disabled = true
      testButton.textContent = '测试中...'
      
      try {
        const result = await this.testConnection()
        
        if (result.success) {
          testResult.createDiv({ 
            cls: 's3-bridge-wizard-test-success',
            text: '✅ 连接测试成功！'
          })
          testResult.createDiv({ 
            cls: 's3-bridge-wizard-test-details',
            text: result.message
          })
        } else {
          testResult.createDiv({ 
            cls: 's3-bridge-wizard-test-error',
            text: '❌ 连接测试失败'
          })
          testResult.createDiv({ 
            cls: 's3-bridge-wizard-test-details',
            text: result.message
          })
        }
      } catch (error) {
        testResult.createDiv({ 
          cls: 's3-bridge-wizard-test-error',
          text: '❌ 测试过程中发生错误'
        })
        testResult.createDiv({ 
          cls: 's3-bridge-wizard-test-details',
          text: error.message
        })
      } finally {
        testButton.disabled = false
        testButton.textContent = '重新测试'
      }
    })
  }

  /**
   * 渲染完成步骤
   */
  private renderCompleteStep(): void {
    const completeContent = this.stepContentEl.createDiv({ cls: 's3-bridge-wizard-complete' })
    
    completeContent.createEl('h3', { text: '🎉 配置完成！' })
    
    completeContent.createEl('p', { 
      text: '您的 S3-Bridge 插件已经成功配置完成。'
    })
    
    const summary = completeContent.createDiv({ cls: 's3-bridge-wizard-summary' })
    summary.createEl('h4', { text: '配置摘要：' })
    
    const summaryList = summary.createEl('ul')
    summaryList.createEl('li', { text: `服务商: ${this.wizardData.template?.name || '自定义'}` })
    summaryList.createEl('li', { text: `存储桶: ${this.wizardData.bucket}` })
    summaryList.createEl('li', { text: `区域: ${this.wizardData.region || '自动检测'}` })
    
    completeContent.createEl('p', { 
      text: '您现在可以开始使用插件了！尝试拖拽图片到编辑器，或者使用批量上传功能。'
    })
    
    const finishButton = completeContent.createEl('button', {
      text: '完成配置',
      cls: 's3-bridge-wizard-finish-button mod-cta'
    })
    
    finishButton.addEventListener('click', () => {
      this.finishWizard()
    })
  }

  /**
   * 渲染导航按钮
   */
  private renderNavigation(): void {
    this.navigationEl.empty()
    
    const canGoBack = this.currentStep > 0
    const canGoForward = this.currentStep < this.steps.length - 1
    
    if (canGoBack) {
      const backButton = this.navigationEl.createEl('button', {
        text: '上一步',
        cls: 's3-bridge-wizard-back-button'
      })
      
      backButton.addEventListener('click', () => {
        this.goToPreviousStep()
      })
    }
    
    if (canGoForward) {
      const nextButton = this.navigationEl.createEl('button', {
        text: '下一步',
        cls: 's3-bridge-wizard-next-button mod-cta'
      })
      
      nextButton.addEventListener('click', () => {
        this.goToNextStep()
      })
    } else {
      const finishButton = this.navigationEl.createEl('button', {
        text: '完成',
        cls: 's3-bridge-wizard-finish-button mod-cta'
      })
      
      finishButton.addEventListener('click', () => {
        this.finishWizard()
      })
    }
  }

  /**
   * 更新向导数据
   */
  private updateWizardData(data: any): void {
    this.wizardData = { ...this.wizardData, ...data }
  }

  /**
   * 选择模板
   */
  private selectTemplate(template: ConfigTemplate): void {
    this.updateWizardData({ 
      template,
      endpoint: template.endpoint,
      region: template.region
    })
    
    // 更新UI
    const cards = this.stepContentEl.querySelectorAll('.s3-bridge-wizard-template-card')
    cards.forEach(card => {
      card.removeClass('selected')
      if (card.getAttribute('data-template-id') === template.id) {
        card.addClass('selected')
      }
    })
  }

  /**
   * 验证基础配置
   */
  private validateBasicConfig(data: any): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    
    if (!data.accessKey) {
      errors.push('Access Key ID 不能为空')
    } else if (validateAccessKey(data.accessKey).error) {
      errors.push(validateAccessKey(data.accessKey).error!)
    }
    
    if (!data.secretKey) {
      errors.push('Secret Access Key 不能为空')
    } else if (validateSecretKey(data.secretKey).error) {
      errors.push(validateSecretKey(data.secretKey).error!)
    }
    
    if (!data.bucket) {
      errors.push('存储桶名称不能为空')
    } else if (validateBucketName(data.bucket).error) {
      errors.push(validateBucketName(data.bucket).error!)
    }
    
    if (data.region && validateRegion(data.region).error) {
      errors.push(validateRegion(data.region).error!)
    }
    
    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * 验证高级配置
   */
  private validateAdvancedConfig(data: any): { valid: boolean; errors: string[] } {
    const errors: string[] = []
    
    if (!data.pathFormat) {
      errors.push('文件路径格式不能为空')
    }
    
    if (!data.filenameFormat) {
      errors.push('文件名格式不能为空')
    }
    
    if (!data.maxUploadMB || data.maxUploadMB < 1 || data.maxUploadMB > 100) {
      errors.push('文件大小限制必须在 1-100MB 之间')
    }
    
    return {
      valid: errors.length === 0,
      errors
    }
  }

  /**
   * 测试连接
   */
  private async testConnection(): Promise<{ success: boolean; message: string }> {
    // 这里应该实现实际的连接测试逻辑
    // 为了演示，我们模拟一个测试
    return new Promise((resolve) => {
      setTimeout(() => {
        // 模拟测试结果
        const success = Math.random() > 0.2 // 80% 成功率
        
        if (success) {
          resolve({
            success: true,
            message: '连接成功，所有配置都正常工作。'
          })
        } else {
          resolve({
            success: false,
            message: '连接失败，请检查您的配置信息。'
          })
        }
      }, 2000)
    })
  }

  /**
   * 转到下一步
   */
  private goToNextStep(): void {
    const currentStep = this.steps[this.currentStep]
    
    // 验证当前步骤
    if (currentStep.validate) {
      const validation = currentStep.validate(this.wizardData)
      if (!validation.valid) {
        new Notice('请修正以下错误：\\n' + validation.errors.join('\\n'))
        return
      }
    }
    
    if (this.currentStep < this.steps.length - 1) {
      this.currentStep++
      this.render()
    }
  }

  /**
   * 转到上一步
   */
  private goToPreviousStep(): void {
    if (this.currentStep > 0) {
      this.currentStep--
      this.render()
    }
  }

  /**
   * 完成向导
   */
  private finishWizard(): void {
    // 保存配置
    this.saveConfiguration()
    
    // 调用完成回调
    this.options.onComplete(this.wizardData)
    
    // 关闭模态框
    this.close()
  }

  /**
   * 保存配置
   */
  private saveConfiguration(): void {
    // 将向导数据保存到配置管理器
    Object.entries(this.wizardData).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        configManager.set(key, value)
      }
    })
    
    new Notice('配置已保存')
  }

  /**
   * 获取配置模板
   */
  private getConfigTemplates(): ConfigTemplate[] {
    return [
      {
        id: 'aws-s3',
        name: 'Amazon S3',
        description: '亚马逊云存储服务，稳定可靠',
        icon: '☁️',
        endpoint: 'https://s3.amazonaws.com',
        region: 'us-east-1',
        website: 'https://aws.amazon.com/s3/',
        documentation: 'https://docs.aws.amazon.com/s3/',
        features: ['高可用性', '安全性强', '全球覆盖'],
        pricing: '按使用量付费'
      },
      {
        id: 'cloudflare-r2',
        name: 'Cloudflare R2',
        description: 'Cloudflare 的对象存储服务',
        icon: '🌐',
        endpoint: 'https://api.cloudflare.com/client/v4/accounts/{account_id}/r2',
        region: 'auto',
        website: 'https://www.cloudflare.com/products/r2/',
        documentation: 'https://developers.cloudflare.com/r2/',
        features: ['无出口流量费', 'CDN 集成', '简单易用'],
        pricing: '按需付费'
      },
      {
        id: 'minio',
        name: 'MinIO',
        description: '开源的对象存储服务器',
        icon: '🗄️',
        endpoint: 'http://localhost:9000',
        region: 'us-east-1',
        website: 'https://min.io/',
        documentation: 'https://docs.min.io/',
        features: ['开源免费', 'S3 兼容', '自托管'],
        pricing: '免费'
      },
      {
        id: 'backblaze-b2',
        name: 'Backblaze B2',
        description: '经济实惠的云存储服务',
        icon: '💰',
        endpoint: 'https://s3.us-west-002.backblazeb2.com',
        region: 'us-west-002',
        website: 'https://www.backblaze.com/b2/',
        documentation: 'https://www.backblaze.com/b2/docs/',
        features: ['价格便宜', 'S3 兼容', '简单易用'],
        pricing: '$0.006/GB/月'
      },
      {
        id: 'digitalocean',
        name: 'DigitalOcean Spaces',
        description: 'DigitalOcean 的对象存储服务',
        icon: '🌊',
        endpoint: 'https://nyc3.digitaloceanspaces.com',
        region: 'nyc3',
        website: 'https://www.digitalocean.com/products/spaces/',
        documentation: 'https://docs.digitalocean.com/products/spaces/',
        features: ['简单易用', '与 DO 生态集成', '价格合理'],
        pricing: '$5/月 起步'
      },
      {
        id: 'custom',
        name: '自定义',
        description: '其他 S3 兼容的存储服务',
        icon: '⚙️',
        endpoint: '',
        region: '',
        website: '',
        documentation: '',
        features: ['S3 兼容', '灵活配置']
      }
    ]
  }
}

// 导出便捷函数
export function showConfigWizard(app: App, options?: WizardOptions): void {
  const modal = new ConfigWizardModal(app, options)
  modal.open()
}