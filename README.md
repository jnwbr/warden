# Warden

**W**arcraft **A**uthentication & **R**oster **D**iscord **EN**forcer

A Discord bot that verifies WoW players using Warcraft Logs parses and manages guild absence requests.

> Named after Blizzard's anti-cheat system - because this bot also keeps the riff-raff out.

## Features

- **Log Verification** - Automatically verify players based on their Warcraft Logs performance
- **Role-based Requirements** - Configurable parse thresholds for DPS, Healers, and Tanks
- **Absence Management** - Guild members can submit absence requests with officer approval workflow
- **Class Detection** - Automatically detects character class and validates role selection
- **Multi-Raid Support** - Pulls parses from Naxx, AQ40, BWL, and MC

## Commands

| Command | Description |
|---------|-------------|
| `/verify <name> <role>` | Verify yourself using your WCL parses |
| `/absence <start> <end> <character> [reason]` | Submit an absence request |
| `/debug <name> <role>` | (Officers only) Debug verification without assigning roles |

## Setup

### 1. Clone the repository
```bash
git clone https://github.com/jnwbr/warden.git
cd warden
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Copy the example env file and fill in your secrets:
```bash
cp .env.example .env
```

Edit `.env`:
```
DISCORD_TOKEN=your_discord_bot_token
WCL_API_KEY=your_warcraft_logs_api_key
```

### 4. Configure settings
Copy the example config and edit with your settings:
```bash
cp config.example.json config.json
```

Edit `config.json` with your WCL server and Discord channel/role IDs:
```json
{
    "server": "thunderstrike",
    "region": "eu",
    "debugdiscordChannelId": "your_debug_channel_id",
    "alternativeVerificationChannelId": "your_manual_verify_channel_id",
    "roleId": "verified_member_role_id",
    "absenceChannelId": "absence_announcements_channel_id",
    "pendingAbsenceChannelId": "officer_approval_channel_id",
    "officerRoleId": "officer_role_id",
    "guildmemberRoleID": "guild_member_role_id",
    "minPercentileDps": 50,
    "minPercentileHealer": 30,
    "minPercentileTank": 30
}
```

**Available servers:** thunderstrike, soulseeker, spineshatter, etc.
**Available regions:** eu, us, kr, tw, cn

**Percentile thresholds:** Minimum average parse percentile required for verification. Adjust these values based on your guild's requirements.

### 5. Run the bot
```bash
node bot.js
```

## Getting API Keys

### Discord Bot Token
1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the token

### Warcraft Logs API Key
1. Go to [Warcraft Logs](https://www.warcraftlogs.com/)
2. Sign in and go to your profile settings
3. Generate a new API key (v1)

## Running as a Service (Linux)

Create a systemd service file:
```bash
sudo nano /etc/systemd/system/warden.service
```

```ini
[Unit]
Description=Warden Discord Bot
After=network.target

[Service]
Type=simple
User=your_user
WorkingDirectory=/path/to/warden
ExecStart=/usr/bin/node bot.js
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl enable warden
sudo systemctl start warden
```

## License

GPL-3.0 - See [LICENSE](LICENSE) for details.

This means you can use, modify, and distribute this code, but any derivative work must also be open source under the same license.