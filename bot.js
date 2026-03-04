const { GatewayIntentBits, Partials } = require('discord.js');
const Discord = require('discord.js');
require('dotenv').config();
const imageVerification = require('./imageVerification');

// Secrets from .env
const token = process.env.DISCORD_TOKEN;
const authorizationKey = process.env.WCL_API_KEY;
const blizzardClientId = process.env.BLIZZARD_CLIENT_ID;
const blizzardClientSecret = process.env.BLIZZARD_CLIENT_SECRET;

// Settings from config.json
const {
    guildId,
    server,
    region,
    debugdiscordChannelId,
    alternativeVerificationChannelId,
    roleId,
    absenceChannelId,
    pendingAbsenceChannelId,
    officerRoleId,
    guildmemberRoleID,
    minPercentileDps,
    minPercentileHealer,
    minPercentileTank
} = require('./config.json');

// Blizzard API configuration
const BLIZZARD_TOKEN_URL = 'https://oauth.battle.net/token';
const BLIZZARD_LOCALE = 'en_GB';

// Blizzard OAuth2 token cache
let blizzardTokenCache = {
    accessToken: null,
    expiresAt: 0
};

// ==================== ERROR LOGGING ====================

async function logErrorToDebugChannel(error, context = {}) {
    try {
        const debugChannel = bot.channels.cache.get(debugdiscordChannelId);
        if (!debugChannel) {
            console.error('Debug channel not found for error logging');
            return;
        }

        const errorEmbed = new Discord.EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('\u26A0\uFE0F Error Occurred')
            .setDescription(`\`\`\`${error.message || 'Unknown error'}\`\`\``)
            .setTimestamp();

        if (context.command) {
            errorEmbed.addFields({ name: 'Command', value: context.command, inline: true });
        }
        if (context.user) {
            errorEmbed.addFields({ name: 'User', value: context.user, inline: true });
        }
        if (context.characterName) {
            errorEmbed.addFields({ name: 'Character', value: context.characterName, inline: true });
        }
        if (context.role) {
            errorEmbed.addFields({ name: 'Role', value: context.role, inline: true });
        }
        if (context.details) {
            errorEmbed.addFields({ name: 'Details', value: context.details, inline: false });
        }

        if (error.stack) {
            const stackTrace = error.stack.length > 1000
                ? error.stack.substring(0, 1000) + '...'
                : error.stack;
            errorEmbed.addFields({ name: 'Stack Trace', value: `\`\`\`${stackTrace}\`\`\``, inline: false });
        }

        await debugChannel.send({ embeds: [errorEmbed] });
    } catch (logError) {
        console.error('Failed to log error to debug channel:', logError);
    }
}

// ==================== UTILITY FUNCTIONS ====================

const getClassColor = (className) => {
    const classColors = {
        'Warrior': '#C79C6E',
        'Paladin': '#F58CBA',
        'Hunter': '#ABD473',
        'Rogue': '#FFF569',
        'Priest': '#FFFFFF',
        'Shaman': '#0070DE',
        'Mage': '#40C7EB',
        'Warlock': '#8787ED',
        'Druid': '#FF7D0A'
    };
    return classColors[className] || '#808080';
};

const getRoleEmoji = (role) => {
    if (role === 'tank') return '\uD83D\uDEE1\uFE0F';
    if (role === 'healer' || role === 'hps') return '\uD83D\uDC9A';
    return '\u2694\uFE0F';
};

const createProgressBar = (percentage) => {
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    const filledChar = '\u2588';
    const emptyChar = '\u2591';

    return filledChar.repeat(filled) + emptyChar.repeat(empty);
};

const getParseQuality = (percentile) => {
    if (percentile >= 95) return '\uD83D\uDFE0 Legendary';
    if (percentile >= 75) return '\uD83D\uDFE3 Epic';
    if (percentile >= 50) return '\uD83D\uDD35 Rare';
    if (percentile >= 25) return '\uD83D\uDFE2 Uncommon';
    return '\u26AA Common';
};

function getValidRolesForClass(className) {
    const classRoles = {
        'Warrior': ['\uD83D\uDEE1\uFE0F Tank', '\u2694\uFE0F DPS'],
        'Paladin': ['\uD83D\uDEE1\uFE0F Tank', '\uD83D\uDC9A Healer', '\u2694\uFE0F DPS'],
        'Hunter': ['\u2694\uFE0F DPS'],
        'Rogue': ['\u2694\uFE0F DPS'],
        'Priest': ['\uD83D\uDC9A Healer', '\u2694\uFE0F DPS'],
        'Shaman': ['\uD83D\uDC9A Healer', '\u2694\uFE0F DPS'],
        'Mage': ['\u2694\uFE0F DPS'],
        'Warlock': ['\u2694\uFE0F DPS'],
        'Druid': ['\uD83D\uDEE1\uFE0F Tank', '\uD83D\uDC9A Healer', '\u2694\uFE0F DPS']
    };

    const roles = classRoles[className] || ['Unknown'];
    return roles.join(', ');
}

// ==================== BLIZZARD API FUNCTIONS ====================

const getItemQualityIndicator = (qualityType) => {
    const indicators = {
        'POOR': '\u2B1C',
        'COMMON': '\u2B1C',
        'UNCOMMON': '\uD83D\uDFE9',
        'RARE': '\uD83D\uDFE6',
        'EPIC': '\uD83D\uDFEA',
        'LEGENDARY': '\uD83D\uDFE7',
        'ARTIFACT': '\uD83D\uDFE8'
    };
    return indicators[qualityType] || '\u2B1C';
};

const getSlotDisplayName = (slotType) => {
    const slotNames = {
        'HEAD': 'Head',
        'NECK': 'Neck',
        'SHOULDER': 'Shoulders',
        'CHEST': 'Chest',
        'WAIST': 'Waist',
        'LEGS': 'Legs',
        'FEET': 'Feet',
        'WRIST': 'Wrists',
        'HANDS': 'Hands',
        'FINGER_1': 'Ring 1',
        'FINGER_2': 'Ring 2',
        'TRINKET_1': 'Trinket 1',
        'TRINKET_2': 'Trinket 2',
        'BACK': 'Back',
        'MAIN_HAND': 'Main Hand',
        'OFF_HAND': 'Off Hand',
        'RANGED': 'Ranged',
        'TABARD': 'Tabard',
        'SHIRT': 'Shirt'
    };
    return slotNames[slotType] || slotType;
};

async function getBlizzardAccessToken() {
    // Return cached token if still valid (with 5-minute safety margin)
    if (blizzardTokenCache.accessToken && Date.now() < blizzardTokenCache.expiresAt - 300000) {
        return blizzardTokenCache.accessToken;
    }

    if (!blizzardClientId || !blizzardClientSecret) {
        throw new Error('Blizzard API credentials not configured. Set BLIZZARD_CLIENT_ID and BLIZZARD_CLIENT_SECRET in .env');
    }

    console.log('Fetching new Blizzard API access token...');

    const credentials = Buffer.from(`${blizzardClientId}:${blizzardClientSecret}`).toString('base64');

    const response = await fetch(BLIZZARD_TOKEN_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${credentials}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: 'grant_type=client_credentials'
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Blizzard OAuth2 token request failed: ${response.status} - ${errorText}`);
    }

    const data = await response.json();

    blizzardTokenCache.accessToken = data.access_token;
    blizzardTokenCache.expiresAt = Date.now() + (data.expires_in * 1000);

    console.log(`Blizzard access token obtained, expires in ${data.expires_in}s`);
    return data.access_token;
}

async function fetchCharacterEquipment(characterName, realmSlug = server, regionCode = region) {
    const accessToken = await getBlizzardAccessToken();
    const apiBase = `https://${regionCode}.api.blizzard.com`;
    const nameSlug = encodeURIComponent(characterName.toLowerCase());
    const realmSlugLower = realmSlug.toLowerCase();

    // Try Classic Era/Anniversary first, then Classic progression
    const namespacesToTry = [
        `profile-classicann-${regionCode}`,
        `profile-classic1x-${regionCode}`,
        `profile-classic-${regionCode}`
    ];

    let lastError = null;

    for (const namespace of namespacesToTry) {
        const url = `${apiBase}/profile/wow/character/${realmSlugLower}/${nameSlug}/equipment?namespace=${namespace}&locale=${BLIZZARD_LOCALE}`;

        console.log(`[Blizzard API] Fetching equipment with namespace ${namespace}`);

        try {
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });

            if (response.ok) {
                const data = await response.json();
                console.log(`[Blizzard API] Success with namespace ${namespace}`);
                return { data, namespace };
            }

            if (response.status === 404) {
                console.log(`[Blizzard API] 404 with namespace ${namespace}, trying next...`);
                lastError = new Error(`Character not found with namespace ${namespace}`);
                continue;
            }

            const errorBody = await response.text();
            console.error(`[Blizzard API] ${response.status} with namespace ${namespace}: ${errorBody}`);
            lastError = new Error(`Blizzard API returned ${response.status}: ${errorBody}`);

        } catch (error) {
            console.error(`[Blizzard API] Network error with namespace ${namespace}:`, error.message);
            lastError = error;
        }
    }

    throw lastError || new Error('Failed to fetch character equipment from all namespaces');
}

async function fetchBlizzardCharacterProfile(characterName, realmSlug = server, regionCode = region) {
    const accessToken = await getBlizzardAccessToken();
    const apiBase = `https://${regionCode}.api.blizzard.com`;
    const nameSlug = encodeURIComponent(characterName.toLowerCase());
    const realmSlugLower = realmSlug.toLowerCase();

    const namespacesToTry = [
        `profile-classicann-${regionCode}`,
        `profile-classic1x-${regionCode}`,
        `profile-classic-${regionCode}`
    ];

    for (const namespace of namespacesToTry) {
        const url = `${apiBase}/profile/wow/character/${realmSlugLower}/${nameSlug}?namespace=${namespace}&locale=${BLIZZARD_LOCALE}`;

        try {
            const response = await fetch(url, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (response.ok) {
                return await response.json();
            }
        } catch (error) {
            console.error(`[Blizzard API] Profile fetch error with ${namespace}:`, error.message);
        }
    }

    return null;
}

function buildGearEmbed(equipmentData, characterName, realmSlug, characterProfile = null) {
    const items = equipmentData.equipped_items || [];

    const itemsBySlot = {};
    items.forEach(item => {
        if (item.slot && item.slot.type) {
            itemsBySlot[item.slot.type] = item;
        }
    });

    let embedColor = '#0099FF';
    if (characterProfile && characterProfile.character_class) {
        embedColor = getClassColor(characterProfile.character_class.name);
    }

    const embed = new Discord.EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`${characterName}'s Gear`)
        .setDescription(`**${realmSlug}** (${region.toUpperCase()})`);

    if (characterProfile) {
        let charInfo = '';
        if (characterProfile.level) charInfo += `Level ${characterProfile.level} `;
        if (characterProfile.character_class) charInfo += characterProfile.character_class.name;
        if (charInfo) {
            embed.setDescription(`${charInfo} - **${realmSlug}** (${region.toUpperCase()})`);
        }
    }

    const armorSlots = ['HEAD', 'NECK', 'SHOULDER', 'BACK', 'CHEST', 'WRIST', 'HANDS', 'WAIST', 'LEGS', 'FEET'];
    const accessorySlots = ['FINGER_1', 'FINGER_2', 'TRINKET_1', 'TRINKET_2', 'MAIN_HAND', 'OFF_HAND', 'RANGED'];

    let armorText = '';
    for (const slot of armorSlots) {
        const item = itemsBySlot[slot];
        if (item) {
            const qi = item.quality ? getItemQualityIndicator(item.quality.type) : '\u2B1C';
            armorText += `${qi} **${getSlotDisplayName(slot)}**: ${item.name}`;
            if (item.level && item.level.value) armorText += ` (${item.level.value})`;
            armorText += '\n';
        } else {
            armorText += `- **${getSlotDisplayName(slot)}**: *Empty*\n`;
        }
    }

    let accessoryText = '';
    for (const slot of accessorySlots) {
        const item = itemsBySlot[slot];
        if (item) {
            const qi = item.quality ? getItemQualityIndicator(item.quality.type) : '\u2B1C';
            accessoryText += `${qi} **${getSlotDisplayName(slot)}**: ${item.name}`;
            if (item.level && item.level.value) accessoryText += ` (${item.level.value})`;
            accessoryText += '\n';
        } else {
            accessoryText += `- **${getSlotDisplayName(slot)}**: *Empty*\n`;
        }
    }

    embed.addFields(
        { name: 'Armor', value: armorText || 'No armor data', inline: true },
        { name: 'Accessories & Weapons', value: accessoryText || 'No data', inline: true }
    );

    // Check for missing enchants on enchantable slots
    const enchantableSlots = ['HEAD', 'SHOULDER', 'CHEST', 'WRIST', 'HANDS', 'LEGS', 'FEET', 'MAIN_HAND'];
    const missingEnchants = [];
    for (const slot of enchantableSlots) {
        const item = itemsBySlot[slot];
        if (item && (!item.enchantments || item.enchantments.length === 0)) {
            missingEnchants.push(getSlotDisplayName(slot));
        }
    }

    if (missingEnchants.length > 0) {
        embed.addFields({
            name: 'Missing Enchants',
            value: missingEnchants.join(', '),
            inline: false
        });
    }

    embed.setTimestamp();
    embed.setFooter({ text: 'Data from Blizzard API' });

    return embed;
}

async function handleGearCheck(characterName, realmSlug = server, regionCode = region) {
    const { data: equipmentData } = await fetchCharacterEquipment(characterName, realmSlug, regionCode);

    let profileData = null;
    try {
        profileData = await fetchBlizzardCharacterProfile(characterName, realmSlug, regionCode);
    } catch (err) {
        console.log('[Blizzard API] Could not fetch profile, proceeding with equipment only');
    }

    return buildGearEmbed(equipmentData, characterName, realmSlug, profileData);
}

// ==================== ARMORY URL PARSING ====================

function parseArmoryUrl(url) {
    // classicwowarmory.com: /character/EU/thunderstrike/chrn?game_version=classic
    const pattern1 = /(?:https?:\/\/)?(?:www\.)?classicwowarmory\.com\/character\/([A-Za-z]+)\/([A-Za-z-]+)\/([A-Za-z\u00C0-\u024F]+)/i;

    // classic-armory.org: /character/eu/tbc-anniversary/thunderstrike/chrn
    const pattern2 = /(?:https?:\/\/)?(?:www\.)?classic-armory\.org\/character\/([A-Za-z]+)\/([A-Za-z0-9-]+)\/([A-Za-z-]+)\/([A-Za-z\u00C0-\u024F]+)/i;

    let match;

    match = url.match(pattern1);
    if (match) {
        let gameVersion = 'classic';
        try {
            const urlObj = new URL(url);
            gameVersion = urlObj.searchParams.get('game_version') || 'classic';
        } catch (e) { /* ignore parse errors */ }
        return {
            source: 'classicwowarmory',
            region: match[1].toLowerCase(),
            realm: match[2].toLowerCase(),
            characterName: match[3],
            flavor: gameVersion
        };
    }

    match = url.match(pattern2);
    if (match) {
        return {
            source: 'classic-armory',
            region: match[1].toLowerCase(),
            flavor: match[2].toLowerCase(),
            realm: match[3].toLowerCase(),
            characterName: match[4]
        };
    }

    return null;
}

function detectArmoryLinks(messageContent) {
    const urlPattern = /https?:\/\/(?:www\.)?(?:classicwowarmory\.com|classic-armory\.org)\/character\/[^\s]+/gi;
    const matches = messageContent.match(urlPattern);
    if (!matches) return [];

    const parsed = [];
    for (const url of matches) {
        const result = parseArmoryUrl(url);
        if (result) {
            parsed.push({ url, ...result });
        }
    }
    return parsed;
}

// ==================== ABSENCE TRACKING ====================

const absences = new Map();

// ==================== BOT SETUP ====================

const bot = new Discord.Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.GuildMembers
    ],
    partials: [Partials.Channel]
});

// Initialize Tesseract OCR worker on startup
imageVerification.initWorker().catch(err => {
    console.warn('Failed to initialize Tesseract worker:', err.message);
});

// Global error handlers
bot.on('error', (error) => {
    console.error('Discord client error:', error);
    logErrorToDebugChannel(error, { details: 'Discord client error' });
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
    logErrorToDebugChannel(error, { details: 'Unhandled promise rejection' });
});

// ==================== WCL API FUNCTIONS ====================

async function tryApiUrls(characterName, characterMetricCheck, authorizationKey) {
    const encodedName = encodeURIComponent(characterName);
    const apiUrls = [
        // mag/gruul
        `https://fresh.warcraftlogs.com:443/v1/parses/character/${encodedName}/${server}/${region}?zone=1048&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}`,
        // kara
        `https://fresh.warcraftlogs.com:443/v1/parses/character/${encodedName}/${server}/${region}?zone=1047&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}`,
        // Naxx
        `https://fresh.warcraftlogs.com:443/v1/parses/character/${encodedName}/${server}/${region}?zone=1036&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}`,
        // AQ40
        `https://fresh.warcraftlogs.com:443/v1/parses/character/${encodedName}/${server}/${region}?zone=1035&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}`,
        // BWL
        `https://fresh.warcraftlogs.com:443/v1/parses/character/${encodedName}/${server}/${region}?zone=1034&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}`,
        // MC
        `https://fresh.warcraftlogs.com:443/v1/parses/character/${encodedName}/${server}/${region}?zone=1028&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}`,
    ];

    const urlsToTry = apiUrls[0] === '[coming soon]' ? apiUrls.slice(1) : apiUrls;

    let combinedData = [];
    let lastError = null;
    let successfulFetches = 0;
    let detectedClass = '';

    for (const apiUrl of urlsToTry) {
        console.log(`Fetching data from: ${apiUrl.split('?')[0]}`);

        try {
            const response = await fetch(apiUrl);

            if (!response.ok) {
                console.error(`API response not ok: ${response.status} for URL: ${apiUrl}`);
                lastError = new Error(`API response not ok: ${response.status}`);
                continue;
            }

            const data = await response.json();

            if (data && data.length > 0) {
                console.log(`Success - Found ${data.length} logs`);

                if (!detectedClass && data[0].class) {
                    detectedClass = data[0].class;
                    console.log(`Character class detected: ${detectedClass}`);
                }

                combinedData = combinedData.concat(data);
                successfulFetches++;
            } else {
                console.log(`No data returned from API call`);
            }

        } catch (error) {
            console.error(`Error with URL ${apiUrl}:`, error);
            lastError = error;
        }
    }

    console.log(`Fetched logs from ${successfulFetches} raid(s), total logs: ${combinedData.length}`);

    if (combinedData.length === 0) {
        if (lastError) {
            console.error("All API URLs failed or returned no data");
            throw lastError;
        }
        return { data: [], detectedClass: '' };
    }

    return { data: combinedData, detectedClass };
}

async function getCharacterDetails(characterName, authorizationKey) {
    try {
        const characterUrl = `https://fresh.warcraftlogs.com:443/v1/character/${encodeURIComponent(characterName)}/${server}/${region}?api_key=${authorizationKey}`;

        const response = await fetch(characterUrl);

        if (!response.ok) {
            console.error(`Failed to get character details: ${response.status}`);
            return null;
        }

        const characterData = await response.json();
        return characterData;
    } catch (error) {
        console.error('Error fetching character details:', error);
        return null;
    }
}

// ==================== INTERACTION HANDLER ====================

bot.on('interactionCreate', async (interaction) => {
    // Handle slash commands
    if (interaction.isCommand()) {

        // ===== VERIFY COMMAND =====
        if (interaction.commandName === 'verify') {
            await interaction.deferReply();

            const characterName = interaction.options.getString('name');
            const characterMetric = interaction.options.getString('role');
            let characterMetricCheck = '';
            let characterClass = '';
            const isDM = !interaction.guild;

            switch(characterMetric.toLowerCase()) {
                case 'dps':
                case 'dd':
                case 'damage dealer':
                case 'damagedealer':
                case 'damage dealer/dps':
                    characterMetricCheck = 'dps';
                    break;
                case 'hps':
                case 'healer':
                case 'healing':
                case 'heal':
                case 'healer/hps':
                    characterMetricCheck = 'hps';
                    break;
                case 'tank':
                    characterMetricCheck = 'dps';
                    break;
                default:
                    const invalidInputEmbed = new Discord.EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('\u274C Invalid Role Specified')
                        .setDescription('Please use one of the valid role options:')
                        .addFields(
                            { name: '\u2694\uFE0F DPS Classes', value: '`dps` or `dd`', inline: true },
                            { name: '\uD83D\uDC9A Healing Classes', value: '`hps` or `healer`', inline: true },
                            { name: '\uD83D\uDEE1\uFE0F Tanks', value: '`tank`', inline: true }
                        )
                        .setFooter({ text: 'Use /verify again with a valid role' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [invalidInputEmbed] });
                    return;
            }

            console.log('Character signed ', characterName);
            console.log('Role signed ', characterMetricCheck);

            // Resolve guild and member (works for both guild and DM contexts)
            let guild;
            let guildMember;

            try {
                if (isDM) {
                    if (!guildId || guildId === 'YOUR_GUILD_ID_HERE') {
                        await interaction.editReply({ content: 'Bot configuration error: guildId not set in config.json. Please contact an administrator.' });
                        return;
                    }
                    guild = await bot.guilds.fetch(guildId);
                    try {
                        guildMember = await guild.members.fetch(interaction.user.id);
                    } catch (fetchError) {
                        const notInGuildEmbed = new Discord.EmbedBuilder()
                            .setColor('#FF0000')
                            .setTitle('Not a Server Member')
                            .setDescription('You must be a member of the Discord server to verify. Please join the server first, then use this command again.')
                            .setTimestamp();
                        await interaction.editReply({ embeds: [notInGuildEmbed] });
                        return;
                    }
                } else {
                    guild = interaction.guild;
                    guildMember = interaction.member;
                }

                // Check if already verified
                if (guildMember.roles.cache.has(roleId)) {
                    const alreadyVerifiedEmbed = new Discord.EmbedBuilder()
                        .setColor('#3498db')
                        .setTitle('Already Verified')
                        .setDescription('You are already verified! No further action needed.')
                        .setTimestamp();
                    await interaction.editReply({ embeds: [alreadyVerifiedEmbed] });
                    return;
                }
            } catch (error) {
                console.error('Error resolving guild/member:', error);
                await logErrorToDebugChannel(error, {
                    command: '/verify',
                    user: interaction.user.tag,
                    details: `Failed to resolve guild/member context. isDM=${isDM}`
                });
                await interaction.editReply({ content: 'An error occurred. Please try again or contact an administrator.' });
                return;
            }

            try {
                const result = await tryApiUrls(characterName, characterMetricCheck, authorizationKey);
                const data = result.data;
                characterClass = result.detectedClass;

                if (!data || data.length === 0) {
                    const errorEmbed = new Discord.EmbedBuilder()
                        .setColor('#FFA500')
                        .setTitle('\u26A0\uFE0F Warcraft Logs Unavailable')
                        .setDescription('It appears that Warcraft Logs is not available at the moment.')
                        .addFields(
                            { name: 'Alternative Verification', value: `Please post a screenshot of your character in <#${alternativeVerificationChannelId}> for manual verification.`, inline: false }
                        )
                        .setTimestamp();

                    await interaction.editReply({ embeds: [errorEmbed] });
                    return;
                }

                if (!characterClass && data.length > 0) {
                    const characterDetails = await getCharacterDetails(characterName, authorizationKey);
                    if (characterDetails && characterDetails.class) {
                        characterClass = characterDetails.class;
                        console.log(`Character class from details endpoint: ${characterClass}`);
                    }
                }

                console.log(`Processing verification for ${characterName} - Class: ${characterClass || 'Unknown'}`);

                let sumPercentiles = 0;
                let entryCount = 0;
                const encounterMap = new Map();

                data.forEach(entry => {
                    const encounterID = entry.encounterID;
                    if (!encounterMap.has(encounterID)) {
                        encounterMap.set(encounterID, entry);
                        sumPercentiles += entry.percentile;
                        entryCount++;
                    }
                });

                const averagePercentile = entryCount > 0 ? sumPercentiles / entryCount : 0;

                const isValidRoleForClass = (className, role) => {
                    const classRoles = {
                        'Warrior': ['tank', 'dps'],
                        'Paladin': ['tank', 'healer', 'dps'],
                        'Hunter': ['dps'],
                        'Rogue': ['dps'],
                        'Priest': ['healer', 'dps'],
                        'Shaman': ['healer', 'dps'],
                        'Mage': ['dps'],
                        'Warlock': ['dps'],
                        'Druid': ['tank', 'healer', 'dps']
                    };

                    const validRoles = classRoles[className] || [];

                    let standardizedRole = role.toLowerCase();
                    if (standardizedRole === 'hps' || standardizedRole === 'heal' || standardizedRole === 'healing') standardizedRole = 'healer';
                    if (standardizedRole === 'tank') standardizedRole = 'tank';
                    if (standardizedRole === 'dps' || standardizedRole === 'dd') standardizedRole = 'dps';

                    return validRoles.includes(standardizedRole);
                };

                if (characterClass && !isValidRoleForClass(characterClass, characterMetric)) {
                    const invalidRoleEmbed = new Discord.EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('\u274C Invalid Role for Class')
                        .setDescription(`**${characterClass}s** cannot be verified as **${characterMetric.toUpperCase()}**`)
                        .addFields(
                            { name: 'Your Class', value: characterClass, inline: true },
                            { name: 'Selected Role', value: characterMetric.toUpperCase(), inline: true },
                            { name: 'Valid Roles', value: getValidRolesForClass(characterClass), inline: false }
                        )
                        .setFooter({ text: 'Please select a valid role for your class' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [invalidRoleEmbed] });
                    return;
                }

                const handleRoleAssignment = async () => {
                    const debugChannel = bot.channels.cache.get(debugdiscordChannelId);

                    try {
                        const role = await guild.roles.fetch(roleId);
                        if (guildMember && role) {
                            await guildMember.roles.add(role);
                            console.log(`Successfully verified ${interaction.user.tag}`);

                            if (debugChannel) {
                                const debugEmbed = new Discord.EmbedBuilder()
                                    .setColor(getClassColor(characterClass))
                                    .setTitle('\u2705 New Member Verified')
                                    .addFields(
                                        { name: 'Discord User', value: `${interaction.user.tag}`, inline: true },
                                        { name: 'Character Name', value: characterName, inline: true },
                                        { name: 'Class', value: characterClass || 'Unknown', inline: true },
                                        { name: 'Role', value: getRoleEmoji(characterMetric) + ' ' + characterMetric.toUpperCase(), inline: true },
                                        { name: 'Average Parse', value: `${averagePercentile.toFixed(1)}%`, inline: true },
                                        { name: 'Parse Quality', value: getParseQuality(averagePercentile), inline: true },
                                        { name: 'Verified Via', value: isDM ? 'Direct Message' : 'Server Channel', inline: true }
                                    )
                                    .setTimestamp();

                                await debugChannel.send({ embeds: [debugEmbed] });
                            } else {
                                console.error('Debug channel not found');
                            }
                        } else {
                            console.error('Guild member or role not found.');
                        }
                    } catch (error) {
                        console.error('Error assigning role:', error);
                        await logErrorToDebugChannel(error, {
                            command: '/verify',
                            user: interaction.user.tag,
                            characterName: characterName,
                            role: characterMetric,
                            details: `Failed to assign verification role. isDM=${isDM}`
                        });
                    }
                };

                // Build success/failure embeds
                const successEmbed = new Discord.EmbedBuilder()
                    .setColor('#00CC00')
                    .setTitle('\u2705 Verification Successful')
                    .setDescription('You have been verified and can now access the server. Enjoy your stay!')
                    .addFields(
                        { name: 'Character', value: characterName, inline: true },
                        { name: 'Class', value: characterClass || 'Unknown', inline: true },
                        { name: 'Role', value: getRoleEmoji(characterMetric) + ' ' + characterMetric.toUpperCase(), inline: true },
                        { name: 'Average Parse', value: `${averagePercentile.toFixed(1)}%`, inline: true },
                        { name: 'Parse Quality', value: getParseQuality(averagePercentile), inline: true }
                    )
                    .setTimestamp();

                const failEmbed = new Discord.EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('\u274C Verification Failed')
                    .setDescription('Your performance does not meet our requirements.')
                    .addFields(
                        { name: 'Character', value: characterName, inline: true },
                        { name: 'Your Average', value: `${averagePercentile.toFixed(1)}%`, inline: true },
                        { name: 'Next Steps', value: 'If you believe this is a mistake, contact an administrator.', inline: false }
                    )
                    .setTimestamp();

                if (characterMetricCheck == 'dps' && characterMetric.toLowerCase() != 'tank') {
                    if (averagePercentile >= minPercentileDps && averagePercentile > 0) {
                        await handleRoleAssignment();
                        await interaction.editReply({ embeds: [successEmbed] });
                    } else {
                        await interaction.editReply({ embeds: [failEmbed] });
                    }
                } else if (['healer', 'hps', 'heal', 'healing'].includes(characterMetric.toLowerCase())) {
                    if (averagePercentile >= minPercentileHealer && averagePercentile > 0) {
                        await handleRoleAssignment();
                        await interaction.editReply({ embeds: [successEmbed] });
                    } else {
                        await interaction.editReply({ embeds: [failEmbed] });
                    }
                } else if (characterMetric.toLowerCase() == 'tank') {
                    if (averagePercentile >= minPercentileTank && averagePercentile > 0) {
                        await handleRoleAssignment();
                        await interaction.editReply({ embeds: [successEmbed] });
                    } else {
                        await interaction.editReply({ embeds: [failEmbed] });
                    }
                }
            } catch (error) {
                console.error('Error fetching data:', error);

                await logErrorToDebugChannel(error, {
                    command: '/verify',
                    user: interaction.user.tag,
                    characterName: characterName,
                    role: characterMetric,
                    details: 'Failed to fetch WCL data'
                });

                const noLogsEmbed = new Discord.EmbedBuilder()
                    .setColor('#FF6B6B')
                    .setTitle('\uD83D\uDCCB No Logs Found')
                    .setDescription(`No logs found for character **"${characterName}"**`)
                    .addFields(
                        { name: 'Alternative Options', value: `\u2022 Post a screenshot in <#${alternativeVerificationChannelId}>\n\u2022 Contact an administrator for assistance`, inline: false },
                        { name: 'Common Issues', value: '\u2022 Character name spelling\n\u2022 No recent raid logs', inline: false }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [noLogsEmbed] });
            }
        }

        // ===== ABSENCE COMMAND =====
        else if (interaction.commandName === 'absence') {
            // DM guard
            if (!interaction.guild) {
                await interaction.reply({ content: 'This command can only be used in a server channel.', ephemeral: true });
                return;
            }

            await interaction.deferReply();

            if (!interaction.member.roles.cache.has(guildmemberRoleID)) {
                await interaction.editReply({
                    content: 'Only guild members can use this command.'
                });
                return;
            }

            const startDate = interaction.options.getString('start');
            const endDate = interaction.options.getString('end');
            const reason = interaction.options.getString('reason') || 'Not specified';
            const absenceCharName = interaction.options.getString('character');

            try {
                const absenceId = Date.now().toString();

                absences.set(interaction.user.id, {
                    id: absenceId,
                    userId: interaction.user.id,
                    username: interaction.user.tag,
                    characterName: absenceCharName,
                    startDate: startDate,
                    endDate: endDate,
                    reason: reason,
                    approved: false,
                    requestedAt: new Date().toISOString()
                });

                const pendingChannel = bot.channels.cache.get(pendingAbsenceChannelId);

                if (!pendingChannel) {
                    console.error('Pending absence channel not found');
                    await interaction.editReply({
                        content: 'Could not submit absence for approval. Please contact an administrator.'
                    });
                    return;
                }

                const approveButton = new Discord.ButtonBuilder()
                    .setCustomId(`approve_absence_${absenceId}`)
                    .setLabel('Approve')
                    .setStyle(Discord.ButtonStyle.Success);

                const denyButton = new Discord.ButtonBuilder()
                    .setCustomId(`deny_absence_${absenceId}`)
                    .setLabel('Deny')
                    .setStyle(Discord.ButtonStyle.Danger);

                const row = new Discord.ActionRowBuilder()
                    .addComponents(approveButton, denyButton);

                const pendingEmbed = new Discord.EmbedBuilder()
                    .setColor('#FFCC00')
                    .setTitle('\uD83D\uDCCB Absence Request')
                    .setDescription(`A new absence request requires approval.`)
                    .addFields(
                        { name: '\uD83D\uDC64 User', value: interaction.user.tag, inline: false },
                        { name: '\uD83C\uDFAE Character', value: absenceCharName || 'Not specified', inline: false },
                        { name: '\uD83D\uDCC5 Period', value: `**From:** ${startDate}\n**To:** ${endDate}`, inline: false },
                        { name: '\uD83D\uDCDD Reason', value: reason, inline: false }
                    )
                    .setTimestamp()
                    .setFooter({ text: `Request ID: ${absenceId}` });

                await pendingChannel.send({
                    content: `<@&${officerRoleId}> New absence request requires approval:`,
                    embeds: [pendingEmbed],
                    components: [row]
                });

                const confirmEmbed = new Discord.EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('\uD83D\uDCCB Absence Request Submitted')
                    .setDescription('Your request has been submitted and is pending officer approval.')
                    .addFields(
                        { name: '\uD83C\uDFAE Character', value: absenceCharName, inline: false },
                        { name: '\uD83D\uDCC5 Period', value: `**From:** ${startDate}\n**To:** ${endDate}`, inline: false },
                        { name: '\uD83D\uDCDD Reason', value: reason, inline: false }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'You will be notified when your request is reviewed' });

                await interaction.editReply({ embeds: [confirmEmbed] });

            } catch (error) {
                console.error('Error processing absence command:', error);
                await logErrorToDebugChannel(error, {
                    command: '/absence',
                    user: interaction.user.tag,
                    details: `Start: ${startDate}, End: ${endDate}, Character: ${absenceCharName}`
                });
                await interaction.editReply({
                    content: 'An error occurred while processing your absence request. Please contact an administrator.'
                });
            }
        }

        // ===== DEBUG COMMAND (Officer Only) =====
        else if (interaction.commandName === 'debug') {
            // DM guard
            if (!interaction.guild) {
                await interaction.reply({ content: 'This command can only be used in a server channel.', ephemeral: true });
                return;
            }

            await interaction.deferReply({ ephemeral: true });

            if (!interaction.member.roles.cache.has(officerRoleId)) {
                await interaction.editReply({
                    content: 'This command is restricted to officers only.',
                    ephemeral: true
                });
                return;
            }

            const debugCharName = interaction.options.getString('name');
            const debugCharMetric = interaction.options.getString('role');
            let debugMetricCheck = '';
            let debugCharClass = '';

            switch(debugCharMetric.toLowerCase()) {
                case 'dps':
                case 'dd':
                case 'damage dealer':
                case 'damagedealer':
                case 'damage dealer/dps':
                    debugMetricCheck = 'dps';
                    break;
                case 'hps':
                case 'healer':
                case 'healing':
                case 'healer/hps':
                    debugMetricCheck = 'hps';
                    break;
                case 'tank':
                    debugMetricCheck = 'dps';
                    break;
                default:
                    await interaction.editReply({
                        content: 'Invalid role specified. Use: dps, healer, or tank',
                        ephemeral: true
                    });
                    return;
            }

            console.log(`[DEBUG] Character: ${debugCharName}, Role: ${debugMetricCheck}`);

            try {
                const zoneNames = {
                    1036: 'Naxx',
                    1035: 'AQ40',
                    1034: 'BWL',
                    1028: 'MC'
                };

                const zonesChecked = [];
                const zoneData = new Map();

                const apiUrls = [
                    { zone: 1048, url: `https://fresh.warcraftlogs.com:443/v1/parses/character/${debugCharName}/${server}/${region}?zone=1048&metric=${debugMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}` },
                    { zone: 1047, url: `https://fresh.warcraftlogs.com:443/v1/parses/character/${debugCharName}/${server}/${region}?zone=1047&metric=${debugMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}` },
                    { zone: 1036, url: `https://fresh.warcraftlogs.com:443/v1/parses/character/${debugCharName}/${server}/${region}?zone=1036&metric=${debugMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}` },
                    { zone: 1035, url: `https://fresh.warcraftlogs.com:443/v1/parses/character/${debugCharName}/${server}/${region}?zone=1035&metric=${debugMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}` },
                    { zone: 1034, url: `https://fresh.warcraftlogs.com:443/v1/parses/character/${debugCharName}/${server}/${region}?zone=1034&metric=${debugMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}` },
                    { zone: 1028, url: `https://fresh.warcraftlogs.com:443/v1/parses/character/${debugCharName}/${server}/${region}?zone=1028&metric=${debugMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}` }
                ];

                let allData = [];

                for (const { zone, url } of apiUrls) {
                    const zoneName = zoneNames[zone];
                    zonesChecked.push(zoneName);

                    console.log(`[DEBUG] Checking Zone ${zone} (${zoneName})`);

                    try {
                        const response = await fetch(url);

                        if (response.ok) {
                            const data = await response.json();
                            if (data && data.length > 0) {
                                console.log(`[DEBUG] Zone ${zoneName}: Found ${data.length} logs`);
                                zoneData.set(zoneName, data);
                                allData = allData.concat(data);

                                if (!debugCharClass && data[0].class) {
                                    debugCharClass = data[0].class;
                                }
                            } else {
                                console.log(`[DEBUG] Zone ${zoneName}: No data`);
                                zoneData.set(zoneName, []);
                            }
                        }
                    } catch (error) {
                        console.error(`[DEBUG] Error fetching Zone ${zoneName}:`, error);
                        zoneData.set(zoneName, []);
                    }
                }

                if (allData.length === 0) {
                    await interaction.editReply({
                        content: `No logs found for character **${debugCharName}**.\n\nZones checked: ${zonesChecked.join(', ')}`,
                        ephemeral: true
                    });
                    return;
                }

                if (!debugCharClass) {
                    const characterDetails = await getCharacterDetails(debugCharName, authorizationKey);
                    if (characterDetails && characterDetails.class) {
                        debugCharClass = characterDetails.class;
                    }
                }

                let sumPercentiles = 0;
                let entryCount = 0;
                const encounterMap = new Map();

                allData.forEach(entry => {
                    const encounterID = entry.encounterID;
                    if (!encounterMap.has(encounterID)) {
                        encounterMap.set(encounterID, entry);
                        sumPercentiles += entry.percentile;
                        entryCount++;
                    }
                });

                const averagePercentile = entryCount > 0 ? sumPercentiles / entryCount : 0;

                let parseDetails = '';
                encounterMap.forEach(entry => {
                    parseDetails += `${entry.encounterName}: ${entry.percentile.toFixed(1)}%\n`;
                });

                let zoneBreakdown = '';
                zoneData.forEach((data, zoneName) => {
                    zoneBreakdown += `**${zoneName}**: ${data.length} logs\n`;
                });

                const debugEmbed = new Discord.EmbedBuilder()
                    .setColor(getClassColor(debugCharClass))
                    .setTitle(`Debug Info: ${debugCharName}`)
                    .setDescription(`Detailed verification data for officer review`)
                    .addFields(
                        { name: 'Character Name', value: debugCharName, inline: true },
                        { name: 'Class', value: debugCharClass || 'Unknown', inline: true },
                        { name: 'Role Checked', value: getRoleEmoji(debugCharMetric) + ' ' + debugMetricCheck.toUpperCase(), inline: true },
                        { name: 'Zones Checked', value: zonesChecked.join(', '), inline: false },
                        { name: 'Zone Breakdown', value: zoneBreakdown || 'No data', inline: false },
                        { name: 'Total Encounters', value: entryCount.toString(), inline: true },
                        { name: 'Average Parse', value: `${averagePercentile.toFixed(1)}%`, inline: true },
                        { name: 'Parse Quality', value: getParseQuality(averagePercentile), inline: true }
                    )
                    .setTimestamp();

                if (parseDetails) {
                    debugEmbed.addFields(
                        { name: 'Individual Parses', value: parseDetails.length > 1024 ? parseDetails.substring(0, 1020) + '...' : parseDetails, inline: false }
                    );
                }

                let verificationStatus = '';
                if (debugMetricCheck === 'dps' && debugCharMetric !== 'tank') {
                    verificationStatus = averagePercentile >= minPercentileDps ? `PASS (\u2265${minPercentileDps}%)` : `FAIL (<${minPercentileDps}%)`;
                } else if (debugCharMetric === 'healer' || debugCharMetric === 'hps') {
                    verificationStatus = averagePercentile >= minPercentileHealer ? `PASS (\u2265${minPercentileHealer}%)` : `FAIL (<${minPercentileHealer}%)`;
                } else if (debugCharMetric === 'tank') {
                    verificationStatus = averagePercentile >= minPercentileTank ? `PASS (\u2265${minPercentileTank}%)` : `FAIL (<${minPercentileTank}%)`;
                }

                debugEmbed.addFields(
                    { name: 'Verification Status', value: verificationStatus, inline: false }
                );

                await interaction.editReply({
                    embeds: [debugEmbed],
                    ephemeral: true
                });

            } catch (error) {
                console.error('[DEBUG] Error:', error);
                await logErrorToDebugChannel(error, {
                    command: '/debug',
                    user: interaction.user.tag,
                    characterName: debugCharName,
                    role: debugCharMetric,
                    details: 'Debug command failed'
                });
                await interaction.editReply({
                    content: `Error fetching debug data: ${error.message}`,
                    ephemeral: true
                });
            }
        }

        // ===== GEAR COMMAND =====
        else if (interaction.commandName === 'gear') {
            await interaction.deferReply();

            const gearCharName = interaction.options.getString('name');
            const realmInput = interaction.options.getString('realm') || server;

            try {
                const gearEmbed = await handleGearCheck(gearCharName, realmInput, region);
                await interaction.editReply({ embeds: [gearEmbed] });
            } catch (error) {
                console.error('[Gear Check] Error:', error);
                await logErrorToDebugChannel(error, {
                    command: '/gear',
                    user: interaction.user.tag,
                    characterName: gearCharName,
                    details: `Realm: ${realmInput}, Error: ${error.message}`
                });

                const errorEmbed = new Discord.EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('Gear Check Failed')
                    .setDescription(`Could not fetch gear for **${gearCharName}** on **${realmInput}**.`)
                    .addFields(
                        { name: 'Possible Reasons', value:
                            '\u2022 Character name may be misspelled\n' +
                            '\u2022 Character may not exist on this realm\n' +
                            '\u2022 Blizzard API may be temporarily unavailable for Classic\n' +
                            '\u2022 Character data may not yet be synced', inline: false }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [errorEmbed] });
            }
        }
    }

    // ===== BUTTON INTERACTIONS =====
    if (interaction.isButton()) {
        const customId = interaction.customId;

        // Handle absence approval
        if (customId.startsWith('approve_absence_')) {
            if (!interaction.member.roles.cache.has(officerRoleId)) {
                await interaction.reply({
                    content: 'You do not have permission to approve absence requests.',
                    ephemeral: true
                });
                return;
            }

            const absenceId = customId.replace('approve_absence_', '');

            let userId = null;
            let absenceData = null;

            for (const [uid, data] of absences.entries()) {
                if (data.id === absenceId) {
                    userId = uid;
                    absenceData = data;
                    break;
                }
            }

            if (!absenceData) {
                await interaction.reply({
                    content: 'Absence request not found. It may have been already processed.',
                    ephemeral: true
                });
                return;
            }

            try {
                absenceData.approved = true;
                absences.set(userId, absenceData);

                const member = await interaction.guild.members.fetch(userId);

                const absenceChannel = bot.channels.cache.get(absenceChannelId);

                const absenceEmbed = new Discord.EmbedBuilder()
                    .setColor('#00CC00')
                    .setTitle('\u2705 Absence Approved')
                    .addFields(
                        { name: '\uD83D\uDC64 User', value: absenceData.username, inline: false },
                        { name: '\uD83C\uDFAE Character', value: absenceData.characterName || 'Not specified', inline: false },
                        { name: '\uD83D\uDCC5 Period', value: `**From:** ${absenceData.startDate}\n**To:** ${absenceData.endDate}`, inline: false },
                        { name: '\uD83D\uDCDD Reason', value: absenceData.reason, inline: false },
                        { name: '\u2705 Approved By', value: interaction.user.tag, inline: false }
                    )
                    .setTimestamp();

                if (absenceChannel) {
                    await absenceChannel.send({ embeds: [absenceEmbed] });
                }

                await interaction.update({
                    content: `Absence request for **${absenceData.username}** has been approved by ${interaction.user.tag}.`,
                    components: []
                });

                try {
                    await member.send(`Your absence request from ${absenceData.startDate} to ${absenceData.endDate} has been approved.`);
                } catch (dmError) {
                    console.log(`Could not DM ${member.user.tag}: ${dmError.message}`);
                }

                const debugChannel = bot.channels.cache.get(debugdiscordChannelId);
                if (debugChannel) {
                    await debugChannel.send(`Absence request for **${absenceData.username}** (${absenceData.startDate} to ${absenceData.endDate}) was approved by ${interaction.user.tag}`);
                }

            } catch (error) {
                console.error('Error approving absence:', error);
                await logErrorToDebugChannel(error, {
                    command: 'approve_absence',
                    user: interaction.user.tag,
                    details: `Absence ID: ${absenceId}, Target user: ${absenceData?.username || 'unknown'}`
                });
                await interaction.reply({
                    content: 'An error occurred while approving this absence request.',
                    ephemeral: true
                });
            }
        }

        // Handle absence denial
        else if (customId.startsWith('deny_absence_')) {
            if (!interaction.member.roles.cache.has(officerRoleId)) {
                await interaction.reply({
                    content: 'You do not have permission to deny absence requests.',
                    ephemeral: true
                });
                return;
            }

            const absenceId = customId.replace('deny_absence_', '');

            let userId = null;
            let absenceData = null;

            for (const [uid, data] of absences.entries()) {
                if (data.id === absenceId) {
                    userId = uid;
                    absenceData = data;
                    break;
                }
            }

            if (!absenceData) {
                await interaction.reply({
                    content: 'Absence request not found. It may have been already processed.',
                    ephemeral: true
                });
                return;
            }

            try {
                absences.delete(userId);

                await interaction.update({
                    content: `Absence request for **${absenceData.username}** has been denied by ${interaction.user.tag}.`,
                    components: []
                });

                try {
                    const member = await interaction.guild.members.fetch(userId);
                    await member.send(`Your absence request from ${absenceData.startDate} to ${absenceData.endDate} has been denied.`);
                } catch (memberError) {
                    console.log(`Could not notify member ${userId}: ${memberError.message}`);
                }

                const debugChannel = bot.channels.cache.get(debugdiscordChannelId);
                if (debugChannel) {
                    await debugChannel.send(`Absence request for **${absenceData.username}** (${absenceData.startDate} to ${absenceData.endDate}) was denied by ${interaction.user.tag}`);
                }

            } catch (error) {
                console.error('Error denying absence:', error);
                await logErrorToDebugChannel(error, {
                    command: 'deny_absence',
                    user: interaction.user.tag,
                    details: `Absence ID: ${absenceId}, Target user: ${absenceData?.username || 'unknown'}`
                });
                await interaction.reply({
                    content: 'An error occurred while denying this absence request.',
                    ephemeral: true
                });
            }
        }
    }
});

// ==================== MESSAGE HANDLER (Armory Links + Images) ====================

bot.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const isDM = !message.guild;

    // 1. Check for armory links in the message
    const armoryLinks = detectArmoryLinks(message.content);
    if (armoryLinks.length > 0) {
        const linksToProcess = armoryLinks.slice(0, 3); // Limit to 3 links per message

        for (const link of linksToProcess) {
            try {
                console.log(`[Armory Link] Detected: ${link.characterName} on ${link.realm} (${link.region}) from ${link.source}`);

                const loadingMsg = await message.reply({
                    content: `Fetching gear for **${link.characterName}** on **${link.realm}**...`,
                    allowedMentions: { repliedUser: false }
                });

                const gearEmbed = await handleGearCheck(link.characterName, link.realm, link.region);

                await loadingMsg.edit({
                    content: '',
                    embeds: [gearEmbed],
                    allowedMentions: { repliedUser: false }
                });

            } catch (error) {
                console.error(`[Armory Link] Failed for ${link.characterName}:`, error.message);
                await message.reply({
                    content: `Could not fetch gear for **${link.characterName}** (${link.realm}). The Blizzard Classic API may be unavailable.`,
                    allowedMentions: { repliedUser: false }
                });
            }
        }
        return; // Don't also process images if we handled links
    }

    // 2. Check for image attachments (only in DMs or the verification channel)
    const imageAttachments = message.attachments.filter(att =>
        att.contentType && imageVerification.ALLOWED_TYPES.includes(att.contentType)
    );

    if (imageAttachments.size === 0) return;

    const isVerificationChannel = message.channel.id === alternativeVerificationChannelId;
    if (!isDM && !isVerificationChannel) return;

    // Rate limiting
    const cooldown = imageVerification.checkCooldown(message.author.id);
    if (cooldown.limited) {
        const secondsLeft = Math.ceil(cooldown.remainingMs / 1000);
        await message.reply(`Please wait ${secondsLeft} seconds before submitting another image.`);
        return;
    }

    const attachment = imageAttachments.first();
    if (attachment.size > imageVerification.MAX_FILE_SIZE) {
        await message.reply('That image is too large. Please send a screenshot under 10MB.');
        return;
    }

    imageVerification.setCooldown(message.author.id);

    const processingMsg = await message.reply({
        embeds: [
            new Discord.EmbedBuilder()
                .setColor('#3498db')
                .setTitle('Processing Screenshot...')
                .setDescription('Analyzing your WoW screenshot locally. This may take a few seconds.')
        ]
    });

    try {
        // Step 1: Preprocess image and run OCR
        const imageBuffer = await imageVerification.preprocessImage(attachment.url);
        const nameResult = await imageVerification.extractCharacterName(imageBuffer);

        if (nameResult.characterName && nameResult.confidence !== 'low') {
            // Character name found - look up via WCL API
            await handleImageNameExtracted(message, processingMsg, nameResult);
        } else {
            // No character name - fallback to color analysis
            await handleImageFallbackAssessment(message, processingMsg, attachment.url, nameResult);
        }

    } catch (error) {
        console.error('Image verification error:', error);
        await logErrorToDebugChannel(error, {
            command: 'image_verification',
            user: message.author.tag,
            details: `Attachment: ${attachment.url}, Error: ${error.message}`
        });

        await processingMsg.edit({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('Processing Failed')
                    .setDescription('Could not process your screenshot. Please try again or use `/verify` instead.')
            ]
        });
    }
});

// Image handler: character name was extracted via OCR
async function handleImageNameExtracted(message, processingMsg, nameResult) {
    const charName = nameResult.characterName;
    const debugChannel = bot.channels.cache.get(debugdiscordChannelId);

    let data = null;
    let metricUsed = 'dps';
    let detectedClass = '';

    try {
        const result = await tryApiUrls(charName, 'dps', authorizationKey);
        data = result.data;
        detectedClass = result.detectedClass;

        if (!data || data.length === 0) {
            metricUsed = 'hps';
            const hpsResult = await tryApiUrls(charName, 'hps', authorizationKey);
            data = hpsResult.data;
            detectedClass = hpsResult.detectedClass || detectedClass;
        }
    } catch (err) {
        console.log(`WCL lookup failed for ${charName}:`, err.message);
    }

    if (data && data.length > 0) {
        const encounterMap = new Map();
        let sumPerc = 0;
        let count = 0;

        data.forEach(entry => {
            if (!detectedClass && entry.class) detectedClass = entry.class;
            if (!encounterMap.has(entry.encounterID)) {
                encounterMap.set(entry.encounterID, entry);
                sumPerc += entry.percentile;
                count++;
            }
        });

        const avgPercentile = count > 0 ? sumPerc / count : 0;

        let parseDetails = '';
        encounterMap.forEach(entry => {
            parseDetails += `${entry.encounterName}: ${entry.percentile.toFixed(1)}%\n`;
        });

        const resultEmbed = new Discord.EmbedBuilder()
            .setColor(getClassColor(detectedClass))
            .setTitle(`Character Found: ${charName}`)
            .setDescription(`Character identified from screenshot (confidence: ${nameResult.confidence})`)
            .addFields(
                { name: 'Character', value: charName, inline: true },
                { name: 'Class', value: detectedClass || 'Unknown', inline: true },
                { name: 'Average Parse', value: `${avgPercentile.toFixed(1)}%`, inline: true },
                { name: 'Parse Quality', value: getParseQuality(avgPercentile), inline: true },
                { name: 'Metric', value: metricUsed.toUpperCase(), inline: true },
                { name: 'Encounters', value: count.toString(), inline: true }
            )
            .setTimestamp();

        if (parseDetails) {
            resultEmbed.addFields({
                name: 'Individual Parses',
                value: parseDetails.length > 1024 ? parseDetails.substring(0, 1020) + '...' : parseDetails,
                inline: false
            });
        }

        resultEmbed.addFields({
            name: 'Next Step',
            value: `Use \`/verify ${charName} ${metricUsed}\` to complete verification and receive your role.`,
            inline: false
        });

        await processingMsg.edit({ embeds: [resultEmbed] });

        if (debugChannel) {
            const debugEmbed = new Discord.EmbedBuilder()
                .setColor('#3498db')
                .setTitle('Image Verification - Name Extracted')
                .addFields(
                    { name: 'Discord User', value: message.author.tag, inline: true },
                    { name: 'Character Found', value: charName, inline: true },
                    { name: 'Confidence', value: nameResult.confidence, inline: true },
                    { name: 'Average Parse', value: `${avgPercentile.toFixed(1)}%`, inline: true }
                )
                .setTimestamp();
            await debugChannel.send({ embeds: [debugEmbed] });
        }
    } else {
        const noDataEmbed = new Discord.EmbedBuilder()
            .setColor('#FFA500')
            .setTitle(`Character: ${charName}`)
            .setDescription(`I found the character name **${charName}** in your screenshot, but no Warcraft Logs data exists for this character on ${server} (${region}).`)
            .addFields(
                { name: 'Possible Reasons', value: '\u2022 Character has no raid logs\n\u2022 Different server/region\n\u2022 Name was misread from the image', inline: false },
                { name: 'What to do', value: `Try \`/verify ${charName} dps\` manually, or contact an officer.`, inline: false }
            )
            .setTimestamp();

        await processingMsg.edit({ embeds: [noDataEmbed] });
    }
}

// Image handler: fallback to color analysis for gear quality
async function handleImageFallbackAssessment(message, processingMsg, imageUrl, nameResult) {
    try {
        const colorAnalysis = await imageVerification.analyzeGearColors(imageUrl);

        const qualityColors = {
            'poor': '#9d9d9d',
            'average': '#1eff00',
            'good': '#0070dd',
            'excellent': '#a335ee',
            'legendary': '#ff8000',
            'unknown': '#808080'
        };

        const assessEmbed = new Discord.EmbedBuilder()
            .setColor(qualityColors[colorAnalysis.overallQuality] || '#808080')
            .setTitle('Gear Assessment (Color Analysis)')
            .setDescription(
                nameResult?.characterName
                    ? `OCR detected "${nameResult.characterName}" but could not verify via logs. Here is a color-based gear estimate.`
                    : 'Could not identify a character name from the screenshot. Here is a color-based gear quality estimate.'
            )
            .addFields(
                { name: 'Overall Quality', value: colorAnalysis.overallQuality || 'Unknown', inline: true },
                { name: 'Epic Clusters', value: String(colorAnalysis.epicCount || 0), inline: true },
                { name: 'Rare Clusters', value: String(colorAnalysis.rareCount || 0), inline: true }
            )
            .setTimestamp();

        if (colorAnalysis.uncommonCount > 0) {
            assessEmbed.addFields({ name: 'Uncommon Clusters', value: String(colorAnalysis.uncommonCount), inline: true });
        }
        if (colorAnalysis.legendaryCount > 0) {
            assessEmbed.addFields({ name: 'Legendary Clusters', value: String(colorAnalysis.legendaryCount), inline: true });
        }

        assessEmbed.addFields({
            name: 'Important',
            value: 'This is an automated color analysis and may not be accurate. For proper verification, use `/verify <name> <role>` or contact an officer.',
            inline: false
        });

        await processingMsg.edit({ embeds: [assessEmbed] });

        const debugChannel = bot.channels.cache.get(debugdiscordChannelId);
        if (debugChannel) {
            const debugEmbed = new Discord.EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('Image Verification - Fallback Assessment')
                .addFields(
                    { name: 'Discord User', value: message.author.tag, inline: true },
                    { name: 'Quality', value: colorAnalysis.overallQuality || 'Unknown', inline: true },
                    { name: 'Name Extraction', value: nameResult?.characterName || 'Failed', inline: true }
                )
                .setTimestamp();
            await debugChannel.send({ embeds: [debugEmbed] });
        }

    } catch (error) {
        console.error('Fallback gear assessment failed:', error);
        await processingMsg.edit({
            embeds: [
                new Discord.EmbedBuilder()
                    .setColor('#FF0000')
                    .setTitle('Assessment Failed')
                    .setDescription('Could not analyze the screenshot. Please use `/verify` with your character name instead.')
            ]
        });
    }
}

// ==================== WELCOME DM ON SERVER JOIN ====================

bot.on('guildMemberAdd', async (member) => {
    console.log(`New member joined: ${member.user.tag} (${member.id})`);

    const debugChannel = bot.channels.cache.get(debugdiscordChannelId);

    const welcomeEmbed = new Discord.EmbedBuilder()
        .setColor('#0070DE')
        .setTitle('Welcome to the Server!')
        .setDescription(`Hey ${member.user.username}, welcome! Before you can access the server, you need to verify your WoW Classic character.`)
        .addFields(
            {
                name: 'How to Verify',
                value: 'Use the `/verify` command right here in this DM, or in the server.',
                inline: false
            },
            {
                name: 'Command Format',
                value: '`/verify name:<character_name> role:<your_role>`',
                inline: false
            },
            {
                name: 'Available Roles',
                value: '**DPS** - `dps` or `dd`\n**Healer** - `healer` or `hps`\n**Tank** - `tank`',
                inline: false
            },
            {
                name: 'Requirements',
                value: `Your character must have Warcraft Logs entries.\nDPS: minimum **${minPercentileDps}%** average parse\nHealer: minimum **${minPercentileHealer}%** average parse\nTank: minimum **${minPercentileTank}%** average parse`,
                inline: false
            },
            {
                name: 'Screenshot Verification',
                value: 'You can also send a screenshot of your character here and I will try to analyze it.',
                inline: false
            },
            {
                name: 'Need Help?',
                value: 'If you have issues, contact an officer in the server.',
                inline: false
            }
        )
        .setFooter({ text: 'Warden Verification Bot' })
        .setTimestamp();

    try {
        await member.send({ embeds: [welcomeEmbed] });
        console.log(`Welcome DM sent to ${member.user.tag}`);

        if (debugChannel) {
            const logEmbed = new Discord.EmbedBuilder()
                .setColor('#3498db')
                .setTitle('New Member Joined')
                .setDescription(`Welcome DM sent to **${member.user.tag}** (${member.id})`)
                .setTimestamp();
            await debugChannel.send({ embeds: [logEmbed] });
        }
    } catch (error) {
        console.error(`Could not DM ${member.user.tag}: ${error.message}`);

        if (debugChannel) {
            const failEmbed = new Discord.EmbedBuilder()
                .setColor('#FFA500')
                .setTitle('Welcome DM Failed')
                .setDescription(`Could not send welcome DM to **${member.user.tag}** (${member.id})`)
                .addFields({
                    name: 'Reason',
                    value: error.code === 50007
                        ? 'User has DMs disabled'
                        : `Error: ${error.message}`,
                    inline: false
                })
                .setTimestamp();
            await debugChannel.send({ embeds: [failEmbed] });
        }
    }
});

// ==================== BOT READY EVENT ====================

bot.once('ready', async () => {
    try {
        // Register verify command (DM enabled)
        await bot.application.commands.create({
            name: 'verify',
            description: "Verify yourself",
            dm_permission: true,
            options: [
                {
                    name: 'name',
                    description: 'Character you want to verify',
                    type: 3,
                    required: true
                },
                {
                    name: 'role',
                    description: 'Role you want to have checked',
                    type: 3,
                    required: true
                }
            ]
        });

        // Register absence command (guild only)
        await bot.application.commands.create({
            name: 'absence',
            description: 'Report a period of absence',
            dm_permission: false,
            options: [
                {
                    name: 'start',
                    description: 'Start date of absence (e.g., "Apr 25" or "Apr 25, 2025")',
                    type: 3,
                    required: true
                },
                {
                    name: 'end',
                    description: 'End date of absence (e.g., "Apr 30" or "Apr 30, 2025")',
                    type: 3,
                    required: true
                },
                {
                    name: 'character',
                    description: 'Your character name used in raids',
                    type: 3,
                    required: true
                },
                {
                    name: 'reason',
                    description: 'Reason for absence (optional)',
                    type: 3,
                    required: false
                }
            ]
        });

        // Register debug command (guild only, officer)
        await bot.application.commands.create({
            name: 'debug',
            description: '[OFFICERS ONLY] Debug character verification (no role assignment)',
            dm_permission: false,
            options: [
                {
                    name: 'name',
                    description: 'Character name to check',
                    type: 3,
                    required: true
                },
                {
                    name: 'role',
                    description: 'Role to check (dps, healer, tank)',
                    type: 3,
                    required: true
                }
            ]
        });

        // Register gear command (check character gear via Blizzard API)
        await bot.application.commands.create({
            name: 'gear',
            description: 'Check a character\'s gear using Blizzard API',
            dm_permission: true,
            options: [
                {
                    name: 'name',
                    description: 'Character name',
                    type: 3,
                    required: true
                },
                {
                    name: 'realm',
                    description: `Realm name (default: ${server})`,
                    type: 3,
                    required: false
                }
            ]
        });

        console.log('Bot is ready and commands registered');

    } catch (error) {
        console.error('Error registering commands:', error);
        await logErrorToDebugChannel(error, {
            details: 'Failed to register slash commands on bot startup'
        });
    }
});

// ==================== LOGIN ====================

async function loginWithRetry(maxRetries = 5, initialDelay = 2000) {
    let retries = 0;

    while (retries < maxRetries) {
        try {
            console.log(retries === 0 ? 'Attempting to login to Discord...' : `Login attempt ${retries + 1}/${maxRetries}...`);
            await bot.login(token);
            console.log('Successfully logged in to Discord');
            return;
        } catch (error) {
            retries++;

            const isNetworkError = error.code === 'EAI_AGAIN' ||
                                   error.code === 'ENOTFOUND' ||
                                   error.code === 'ETIMEDOUT' ||
                                   error.code === 'ECONNREFUSED';

            if (isNetworkError && retries < maxRetries) {
                const delay = initialDelay * Math.pow(2, retries - 1);
                console.error(`Network error (${error.code}): ${error.message}`);
                console.log(`Retrying in ${delay}ms... (${retries}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error('Failed to login to Discord:', error);
                if (retries >= maxRetries) {
                    console.error('Max retries reached. Exiting...');
                }
                throw error;
            }
        }
    }
}

// Start the bot with retry logic
loginWithRetry().catch(error => {
    console.error('Fatal error: Could not connect to Discord after multiple attempts');
    process.exit(1);
});
