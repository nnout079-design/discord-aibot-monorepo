# Phase 1: Secure Foundation & Slash Commands

## 🎯 Phase 1 Objectives (Security-First Approach)

**Primary Goal:** Implement Discord slash commands with comprehensive security measures while adding bot-specific features.

**Security Priorities:**
- Secure command handling and input validation
- Rate limiting and abuse prevention
- Permission-based command access
- Secure API key management
- Audit logging for command usage

---

## 📋 Implementation Plan

### Part 1: Security Foundation (1 hour)

#### 1.1 Command Security Framework
**File:** `src/utils/command-security.ts`

```typescript
// Security utilities for command handling
export class CommandSecurity {
  // Rate limiting per user
  private static rateLimits = new Map<string, number[]>();
  
  // Input validation
  static validateInput(input: string, maxLength: number = 1000): boolean {
    return input.length <= maxLength && !this.containsMaliciousPatterns(input);
  }
  
  // Permission checking
  static hasPermission(userId: string, requiredRole: string): boolean {
    // Implement role-based access control
    return true; // Placeholder
  }
  
  // Rate limiting
  static checkRateLimit(userId: string, maxRequests: number = 10, windowMs: number = 60000): boolean {
    const now = Date.now();
    const userRequests = this.rateLimits.get(userId) || [];
    const recentRequests = userRequests.filter(time => now - time < windowMs);
    
    if (recentRequests.length >= maxRequests) {
      return false;
    }
    
    recentRequests.push(now);
    this.rateLimits.set(userId, recentRequests);
    return true;
  }
  
  // Audit logging
  static logCommandUsage(userId: string, command: string, args: any): void {
    console.log(`[AUDIT] User ${userId} executed /${command} with args:`, args);
  }
  
  private static containsMaliciousPatterns(input: string): boolean {
    const patterns = [
      /<script>/i,
      /javascript:/i,
      /on\w+=/i,
      /data:/i
    ];
    return patterns.some(pattern => pattern.test(input));
  }
}
```

#### 1.2 Secure Environment Configuration
**File:** `src/utils/env-security.ts`

```typescript
// Secure environment variable handling
export class EnvSecurity {
  static getSecureVar(key: string): string | undefined {
    const value = process.env[key];
    if (!value) {
      console.error(`[SECURITY] Missing required environment variable: ${key}`);
      return undefined;
    }
    return value;
  }
  
  static validateToken(token: string): boolean {
    // Basic token validation
    return token && token.length > 20 && /^[A-Za-z0-9_\-\.]+$/.test(token);
  }
}
```

---

### Part 2: Slash Command Infrastructure (1 hour)

#### 2.1 Command Registration System
**File:** `src/commands/register.ts`

```typescript
import { REST, Routes } from 'discord.js';
import * as commands from './index';

export async function registerCommands() {
  const commandsArray = Object.values(commands).map(cmd => cmd.data.toJSON());
  
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN!);
  
  try {
    console.log(`Started refreshing ${commandsArray.length} application (/) commands.`);
    
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID!),
      { body: commandsArray }
    );
    
    console.log(`Successfully reloaded ${commandsArray.length} application (/) commands.`);
  } catch (error) {
    console.error('Error registering commands:', error);
  }
}
```

#### 2.2 Command Handler with Security
**File:** `src/handlers/command-handler.ts`

```typescript
import { CommandInteraction } from 'discord.js';
import { CommandSecurity } from '../utils/command-security';

export async function handleCommand(interaction: CommandInteraction) {
  const { commandName, user } = interaction;
  
  // Security checks
  if (!CommandSecurity.checkRateLimit(user.id)) {
    await interaction.reply({ 
      content: 'Rate limit exceeded. Please try again later.', 
      ephemeral: true 
    });
    return;
  }
  
  // Log command usage
  CommandSecurity.logCommandUsage(user.id, commandName, interaction.options);
  
  // Execute command
  try {
    const command = require(`../commands/${commandName}`);
    await command.execute(interaction);
  } catch (error) {
    console.error(`Error executing ${commandName}:`, error);
    await interaction.reply({ 
      content: 'There was an error executing this command.', 
      ephemeral: true 
    });
  }
}
```

---

### Part 3: Bot-Specific Secure Commands (1 hour)

#### 3.1 Soundproof Gaming Bot Commands
**File:** `src/commands/soundproof/stats.ts`

```typescript
import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { CommandSecurity } from '../../utils/command-security';

export const data = new SlashCommandBuilder()
  .setName('stats')
  .setDescription('Get gaming statistics')
  .addUserOption(option =>
    option.setName('user')
      .setDescription('User to get stats for')
      .setRequired(false)
  );

export async function execute(interaction: CommandInteraction) {
  // Security validation
  if (!CommandSecurity.validateInput(interaction.user.id)) {
    await interaction.reply({ content: 'Invalid input.', ephemeral: true });
    return;
  }
  
  const targetUser = interaction.options.getUser('user') || interaction.user;
  
  // Secure database query (placeholder)
  const stats = await getSecureUserStats(targetUser.id);
  
  await interaction.reply({
    content: `📊 **${targetUser.username}'s Stats**\nWins: ${stats.wins}\nLosses: ${stats.losses}`,
    ephemeral: true
  });
}

async function getSecureUserStats(userId: string) {
  // Implement secure database query with parameterized statements
  return { wins: 0, losses: 0 }; // Placeholder
}
```

#### 3.2 Discord AI Bot Commands
**File:** `src/commands/discord-aibot/ask.ts`

```typescript
import { SlashCommandBuilder, CommandInteraction } from 'discord.js';
import { CommandSecurity } from '../../utils/command-security';
import { EnvSecurity } from '../../utils/env-security';

export const data = new SlashCommandBuilder()
  .setName('ask')
  .setDescription('Ask AI a question')
  .addStringOption(option =>
    option.setName('question')
      .setDescription('Your question')
      .setRequired(true)
      .setMaxLength(500)
  );

export async function execute(interaction: CommandInteraction) {
  const question = interaction.options.getString('question');
  
  // Security validation
  if (!question || !CommandSecurity.validateInput(question, 500)) {
    await interaction.reply({ content: 'Invalid question format.', ephemeral: true });
    return;
  }
  
  // Input sanitization
  const sanitizedQuestion = sanitizeInput(question);
  
  // Check API key security
  const apiKey = EnvSecurity.getSecureVar('CLAUDE_API_KEY');
  if (!apiKey || !EnvSecurity.validateToken(apiKey)) {
    await interaction.reply({ content: 'AI service unavailable.', ephemeral: true });
    return;
  }
  
  await interaction.deferReply();
  
  try {
    const response = await getAIResponse(sanitizedQuestion, apiKey);
    await interaction.editReply({ content: response });
  } catch (error) {
    await interaction.editReply({ content: 'Error processing your request.' });
  }
}

function sanitizeInput(input: string): string {
  return input
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

async function getAIResponse(question: string, apiKey: string): Promise<string> {
  // Implement secure AI API call with rate limiting
  return 'AI response placeholder'; // Placeholder
}
```

---

### Part 4: Integration & Testing (1 hour)

#### 4.1 Update Main Bot File
**File:** `src/index.ts`

```typescript
import dotenv from 'dotenv';
import { Client, GatewayIntentBits, Collection } from 'discord.js';
import { registerCommands } from './commands/register';
import { handleCommand } from './handlers/command-handler';

dotenv.config();

const client = new Client({ 
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages
  ]
});

client.commands = new Collection();

// Load commands
// (Load command files into client.commands)

client.once('ready', async () => {
  console.log('✓ Bot ready');
  await registerCommands();
});

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;
  await handleCommand(interaction);
});

// Security validation before login
const token = process.env.DISCORD_TOKEN;
if (!token || token.length < 20) {
  console.error('Invalid Discord token');
  process.exit(1);
}

client.login(token);
```

#### 4.2 Security Testing Procedures

**Testing Checklist:**
- [ ] Test rate limiting works correctly
- [ ] Verify input validation blocks malicious input
- [ ] Confirm permission checks function properly
- [ ] Test audit logging captures all commands
- [ ] Verify API keys are not exposed in logs
- [ ] Test error handling doesn't leak sensitive information
- [ ] Confirm memory limits prevent resource exhaustion
- [ ] Verify network isolation is maintained

**Security Test Commands:**
```powershell
# Test rate limiting
# Rapidly execute commands to trigger rate limit

# Test input validation
# Try commands with malicious input patterns

# Test permission system
# Try commands with different user roles

# Test resource limits
# Monitor resource usage during command execution
```

---

## 🔒 Security Considerations by Phase

### Phase 1 Security Focus:
- ✅ Command input validation and sanitization
- ✅ Rate limiting and abuse prevention
- ✅ Permission-based access control
- ✅ Audit logging for security monitoring
- ✅ Secure API key handling
- ✅ Error handling that doesn't leak information

### Future Phase Security:
- **Phase 2:** Encrypted database connections, secure secrets management
- **Phase 3:** AI input/output filtering, prompt injection prevention
- **Phase 4:** Secure monitoring dashboards, alert configuration
- **Phase 5:** User data encryption, secure authentication

---

## 📋 Implementation Order

1. **Security Foundation** → Implement security utilities first
2. **Command Infrastructure** → Build secure command handling
3. **Basic Commands** → Start with simple, safe commands (ping, help)
4. **Bot-Specific Commands** → Add specialized features with security
5. **Testing & Validation** → Comprehensive security testing
6. **Documentation** → Update security documentation

---

## 🚀 Deployment Steps

1. **Set environment variables** with strong passwords
2. **Build Docker images** with security-hardened configuration
3. **Deploy locally** using `docker-compose up -d`
4. **Test security measures** before public deployment
5. **Monitor logs** for security events
6. **Scale gradually** after security validation

---

## 🎯 Success Criteria

**Security Metrics:**
- ✅ All inputs validated before processing
- ✅ Rate limiting prevents abuse
- ✅ No sensitive data in logs
- ✅ All commands properly authenticated
- ✅ Resource limits enforced
- ✅ Network isolation maintained

**Functional Metrics:**
- ✅ Slash commands respond correctly
- ✅ Bot-specific features operational
- ✅ Error handling graceful
- ✅ Performance within resource limits

---

**Estimated Time:** 4 hours
**Security Level:** High
**Risk Assessment:** Low (with proper testing)