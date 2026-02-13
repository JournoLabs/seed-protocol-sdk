export interface AppConfig {
  apiKey: string;
  secretToken: string;
  webhookUrl: string;
  databaseUrl: string;
}

export class ConfigService {
  static async getConfig(): Promise<AppConfig> {
    return await window.electronAPI.config.get();
  }

  static async getConfigValue(key: keyof AppConfig): Promise<string> {
    return await window.electronAPI.config.get(key);
  }

  static async setConfigValue(key: keyof AppConfig, value: string): Promise<boolean> {
    return await window.electronAPI.config.set(key, value);
  }

  static async hasRequiredConfig(): Promise<boolean> {
    return await window.electronAPI.config.hasRequired();
  }

  static async clearConfig(): Promise<boolean> {
    return await window.electronAPI.config.clear();
  }

  static async saveConfig(config: AppConfig): Promise<boolean> {
    const promises = Object.entries(config).map(([key, value]) =>
      this.setConfigValue(key as keyof AppConfig, value)
    );
    
    const results = await Promise.all(promises);
    return results.every(result => result === true);
  }
} 