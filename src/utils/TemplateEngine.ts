import * as fs from 'fs';
import * as path from 'path';

/**
 * Simple template engine for HTML templates with variable substitution
 */
export class TemplateEngine {
    private static templateCache = new Map<string, string>();

    /**
     * Load and process a template with variable substitutions
     * @param templateName - Name of the template file (without .html extension)
     * @param variables - Object with variable substitutions
     * @returns Processed HTML string
     */
    static render(templateName: string, variables: Record<string, any> = {}): string {
        const template = this.loadTemplate(templateName);
        return this.processTemplate(template, variables);
    }

    /**
     * Load template from file with caching
     */
    private static loadTemplate(templateName: string): string {
        if (this.templateCache.has(templateName)) {
            return this.templateCache.get(templateName)!;
        }

        const templatePath = path.join(__dirname, '..', 'templates', `${templateName}.html`);
        
        try {
            const templateContent = fs.readFileSync(templatePath, 'utf-8');
            this.templateCache.set(templateName, templateContent);
            return templateContent;
        } catch (error) {
            throw new Error(`Failed to load template '${templateName}': ${error}`);
        }
    }

    /**
     * Process template with variable substitutions
     * Supports {{variable}} syntax and conditional blocks {{#if condition}}...{{/if}}
     */
    private static processTemplate(template: string, variables: Record<string, any>): string {
        let processed = template;

        // Simple variable substitution {{variable}}
        processed = processed.replace(/\{\{([^}]+)\}\}/g, (match, variableName) => {
            const trimmed = variableName.trim();
            return this.getNestedValue(variables, trimmed) ?? match;
        });

        // Conditional blocks {{#if condition}}...{{/if}}
        processed = processed.replace(/\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, condition, content) => {
            const conditionValue = this.evaluateCondition(condition.trim(), variables);
            return conditionValue ? content : '';
        });

        // Loop blocks {{#each items}}...{{/each}}
        processed = processed.replace(/\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g, (match, arrayName, content) => {
            const array = this.getNestedValue(variables, arrayName.trim());
            if (!Array.isArray(array)) return '';
            
            return array.map((item, index) => {
                let itemContent = content;
                // Replace {{this}} with current item
                itemContent = itemContent.replace(/\{\{this\}\}/g, String(item));
                // Replace {{@index}} with current index
                itemContent = itemContent.replace(/\{\{@index\}\}/g, String(index));
                return itemContent;
            }).join('');
        });

        return processed;
    }

    /**
     * Get nested object value using dot notation
     */
    private static getNestedValue(obj: any, path: string): any {
        return path.split('.').reduce((current, key) => current?.[key], obj);
    }

    /**
     * Evaluate simple conditions for {{#if}}
     */
    private static evaluateCondition(condition: string, variables: Record<string, any>): boolean {
        // Simple boolean check
        const value = this.getNestedValue(variables, condition);
        return Boolean(value);
    }

    /**
     * Clear template cache (useful for development)
     */
    static clearCache(): void {
        this.templateCache.clear();
    }

    /**
     * Register a custom helper function
     */
    static registerHelper(name: string, helper: (...args: any[]) => string): void {
        // Future enhancement: custom helpers
    }
}

/**
 * Default template variables for VS Code webviews
 */
export const getDefaultTemplateVariables = () => ({
    cspSource: '{{cspSource}}', // Will be replaced by VS Code webview
    nonce: '{{nonce}}',         // Will be replaced by VS Code webview
    webviewUri: '{{webviewUri}}' // Will be replaced by VS Code webview
});

/**
 * Utility to create VS Code compatible template
 */
export const createWebviewTemplate = (
    templateName: string, 
    variables: Record<string, any> = {},
    webview?: any
): string => {
    const defaultVars = getDefaultTemplateVariables();
    const mergedVars = { ...defaultVars, ...variables };
    
    let html = TemplateEngine.render(templateName, mergedVars);
    
    // Replace VS Code specific placeholders if webview is provided
    if (webview) {
        const nonce = getNonce();
        html = html.replace(/\{\{cspSource\}\}/g, webview.cspSource);
        html = html.replace(/\{\{nonce\}\}/g, nonce);
        html = html.replace(/\{\{webviewUri\}\}/g, webview.asWebviewUri);
    }
    
    return html;
};

/**
 * Generate a random nonce for CSP
 */
function getNonce(): string {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}