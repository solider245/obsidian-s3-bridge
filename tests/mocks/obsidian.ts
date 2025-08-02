// tests/mocks/obsidian.ts

// 模拟 Notice 类，因为它在 s3Manager 中被使用
export class Notice {
  constructor(message: string) {
    // 在测试环境中，我们可以让它什么都不做，或者打印到控制台
    // console.log(`(Notice) ${message}`);
  }
}

// 模拟其他可能需要的类型，以防未来测试需要
export class Plugin {}
export class App {}
export class Vault {}
