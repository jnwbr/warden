const { GatewayIntentBits } = require('discord.js');
const Discord = require('discord.js');
require('dotenv').config();

// Secrets from .env
const token = process.env.DISCORD_TOKEN;
const authorizationKey = process.env.WCL_API_KEY;

// Settings from config.json
const {
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

let characterName = '';
let characterMetric = '';
let characterMetricCheck = '';
let simplifiedDataString = '';
let sumPercentiles = 0;
let entryCount = 0;
let characterClass = '';

// Error logging helper - posts errors to debug channel
async function logErrorToDebugChannel(error, context = {}) {
    try {
        const debugChannel = bot.channels.cache.get(debugdiscordChannelId);
        if (!debugChannel) {
            console.error('Debug channel not found for error logging');
            return;
        }

        const errorEmbed = new Discord.EmbedBuilder()
            .setColor('#FF0000')
            .setTitle('⚠️ Error Occurred')
            .setDescription(`\`\`\`${error.message || 'Unknown error'}\`\`\``)
            .setTimestamp();

        // Add context fields if provided
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

        // Add stack trace (truncated)
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
    if (role === 'tank') return '🛡️';
    if (role === 'healer' || role === 'hps') return '💚';
    return '⚔️';
};

const createProgressBar = (percentage) => {
    const filled = Math.round(percentage / 10);
    const empty = 10 - filled;
    const filledChar = '█';
    const emptyChar = '░';
    
    return filledChar.repeat(filled) + emptyChar.repeat(empty);
};

const getParseQuality = (percentile) => {
    if (percentile >= 95) return '🟠 Legendary';
    if (percentile >= 75) return '🟣 Epic';
    if (percentile >= 50) return '🔵 Rare';
    if (percentile >= 25) return '🟢 Uncommon';
    return '⚪ Common';
};

function getValidRolesForClass(className) {
    const classRoles = {
        'Warrior': ['🛡️ Tank', '⚔️ DPS'],
        'Paladin': ['🛡️ Tank', '💚 Healer', '⚔️ DPS'],
        'Hunter': ['⚔️ DPS'],
        'Rogue': ['⚔️ DPS'],
        'Priest': ['💚 Healer', '⚔️ DPS'],
        'Shaman': ['💚 Healer', '⚔️ DPS'],
        'Mage': ['⚔️ DPS'],
        'Warlock': ['⚔️ DPS'],
        'Druid': ['🛡️ Tank', '💚 Healer', '⚔️ DPS']
    };

    const roles = classRoles[className] || ['Unknown'];
    return roles.join(', ');
}

// Absence tracking system
const absences = new Map(); // userId -> {id, userId, username, startDate, endDate, reason, approved, characterName}

const bot = new Discord.Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ]
});

// Add global error handler to prevent crashes
bot.on('error', (error) => {
    console.error('Discord client error:', error);
    logErrorToDebugChannel(error, { details: 'Discord client error' });
});

process.on('unhandledRejection', (error) => {
    console.error('Unhandled promise rejection:', error);
    logErrorToDebugChannel(error, { details: 'Unhandled promise rejection' });
});


// Fetch data from ALL raids and combine them for comprehensive verification
async function tryApiUrls(characterName, characterMetricCheck, authorizationKey) {
    // URLs for all raids - we'll try ALL of them and combine the results
    const apiUrls = [
	// Naxx no phase
	`https://fresh.warcraftlogs.com:443/v1/parses/character/${characterName}/${server}/${region}?zone=1036&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}`,

	// AQ no Phase
	`https://fresh.warcraftlogs.com:443/v1/parses/character/${characterName}/${server}/${region}?zone=1035&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}`,

    // BWL no Phase
    `https://fresh.warcraftlogs.com:443/v1/parses/character/${characterName}/${server}/${region}?zone=1034&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}`,

    // MC no Phase
    `https://fresh.warcraftlogs.com:443/v1/parses/character/${characterName}/${server}/${region}?zone=1028&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}`,

    ];

    // Skip the first URL if it's still a placeholder
    const urlsToTry = apiUrls[0] === '[coming soon]' ? apiUrls.slice(1) : apiUrls;

    let combinedData = [];
    let lastError = null;
    let successfulFetches = 0;

    // Try ALL URLs and combine the data from all raids
    for (const apiUrl of urlsToTry) {
        console.log(`Fetching data from: ${apiUrl}`);

        try {
            const response = await fetch(apiUrl);

            if (!response.ok) {
                console.error(`API response not ok: ${response.status} for URL: ${apiUrl}`);
                lastError = new Error(`API response not ok: ${response.status}`);
                continue;
            }

            const data = await response.json();

            // If we have data, add it to our combined dataset
            if (data && data.length > 0) {
                console.log(`Success with URL: ${apiUrl} - Found ${data.length} logs`);

                // Extract class from the first parse entry if we haven't yet
                if (!characterClass && data[0].class) {
                    characterClass = data[0].class;
                    console.log(`Character class detected: ${characterClass}`);
                }

                // Add all logs from this raid to our combined data
                combinedData = combinedData.concat(data);
                successfulFetches++;
            } else {
                console.log(`No data returned from URL: ${apiUrl}`);
            }

        } catch (error) {
            console.error(`Error with URL ${apiUrl}:`, error);
            lastError = error;
        }
    }

    // Log summary of what we found
    console.log(`Fetched logs from ${successfulFetches} raid(s), total logs: ${combinedData.length}`);

    // If we didn't get any data from any raid, throw error or return empty
    if (combinedData.length === 0) {
        if (lastError) {
            console.error("All API URLs failed or returned no data");
            throw lastError;
        }
        return [];
    }

    return combinedData;
}

async function getCharacterDetails(characterName, authorizationKey) {
    try {
        // WCL character endpoint for more detailed info
        const characterUrl = `https://fresh.warcraftlogs.com:443/v1/character/${characterName}/${server}/${region}?api_key=${authorizationKey}`;
        
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

// Handle all interactions (both slash commands and buttons)
bot.on('interactionCreate', async (interaction) => {
    // Handle slash commands
    if (interaction.isCommand()) {
        // Verify command
        if (interaction.commandName === 'verify') {
            // Defer the reply immediately to prevent timeout
            await interaction.deferReply();
            
            characterName = interaction.options.getString('name');
            characterMetric = interaction.options.getString('role');
            characterClass = '';

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
                    // await interaction.editReply({ content: 'Invalid role specified. Allowed roles for DPS classes are "**dps OR dd**". Allowed roles for HEALING classes are "**hps OR healer**". Allowed role for TANKS is "**tank**".' });

                    const invalidInputEmbed = new Discord.EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('❌ Invalid Role Specified')
                        .setDescription('Please use one of the valid role options:')
                        .addFields(
                            { name: '⚔️ DPS Classes', value: '`dps` or `dd`', inline: true },
                            { name: '💚 Healing Classes', value: '`hps` or `healer`', inline: true },
                            { name: '🛡️ Tanks', value: '`tank`', inline: true }
                        )
                        .setFooter({ text: 'Use /verify again with a valid role' })
                        .setTimestamp();

                    await interaction.editReply({ embeds: [invalidInputEmbed] });

                    return;
            }   

            console.log('Character signed ', characterName) 
            console.log('Role signed ', characterMetricCheck) 

            try {
                // Try each API URL pattern sequentially
                let data = await tryApiUrls(characterName, characterMetricCheck, authorizationKey);
                
                if (!data || data.length === 0) {
                    // await interaction.editReply({ 
                    //     content: `It appears that warcraftlogs is not available at the moment. Please post a screenshot of your character in <#${alternativeVerificationChannelId}> for manual verification.`
                    // });

                    const errorEmbed = new Discord.EmbedBuilder()
                        .setColor('#FFA500')
                        .setTitle('⚠️ Warcraft Logs Unavailable')
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

                // Reset these variables for each new verification
                sumPercentiles = 0;
                entryCount = 0;
                simplifiedDataString = '';

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

                encounterMap.forEach(entry => {
                    simplifiedDataString += `${entry.characterName}: ${entry.percentile}\n`;
                });

                console.log(simplifiedDataString);

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
                    
                    // Map role input to standardized role
                    let standardizedRole = role.toLowerCase();
                    if (standardizedRole === 'hps' || standardizedRole === 'heal' || standardizedRole === 'healing') standardizedRole = 'healer';
                    if (standardizedRole === 'tank') standardizedRole = 'tank';
                    if (standardizedRole === 'dps' || standardizedRole === 'dd') standardizedRole = 'dps';

                    return validRoles.includes(standardizedRole);
                };

                if (characterClass && !isValidRoleForClass(characterClass, characterMetric)) {
                    
                    const invalidRoleEmbed = new Discord.EmbedBuilder()
                        .setColor('#FF0000')
                        .setTitle('❌ Invalid Role for Class')
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
                    const guildMember = interaction.member;
                    const debugChannel = bot.channels.cache.get(debugdiscordChannelId);

                    try {
                        const role = await interaction.guild.roles.fetch(roleId);
                        if (guildMember && role) {
                            await guildMember.roles.add(role);
                            console.log(`Successfully verified ${guildMember.user.tag}`);
                            
                            if (debugChannel) {
                                // await debugChannel.send(`Successfully verified **${guildMember.user.tag}** with the charactername **${characterName}** (${characterClass || 'Unknown Class'}) as ${characterMetric}.\nAverage rating: **${averagePercentile}**`);

                                const debugEmbed = new Discord.EmbedBuilder()
                                    .setColor(getClassColor(characterClass))
                                    .setTitle('✅ New Member Verified')

                                    .addFields(
                                        { name: 'Discord User', value: `${guildMember.user.tag}`, inline: true },
                                        { name: 'Character Name', value: characterName, inline: true },
                                        { name: 'Class', value: characterClass || 'Unknown', inline: true },
                                        { name: 'Role', value: getRoleEmoji(characterMetric) + ' ' + characterMetric.toUpperCase(), inline: true },
                                        { name: 'Average Parse', value: `${averagePercentile.toFixed(1)}%`, inline: true },
                                        { name: 'Parse Quality', value: getParseQuality(averagePercentile), inline: true }
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
                            details: 'Failed to assign verification role'
                        });
                    }
                };

                if (characterMetricCheck == 'dps' && characterMetric != 'tank') {
                    if (averagePercentile >= minPercentileDps && averagePercentile > 0) {
                        await handleRoleAssignment();
                        await interaction.editReply({ content: `Successfully verified, enjoy your stay` });
                    } else {
                        await interaction.editReply({ content: `Your performance does not meet our requirements. If you believe this is a mistake, you can contact an administrator.` });
                    }
                } else if (['healer', 'hps', 'heal', 'healing'].includes(characterMetric.toLowerCase())) {
                    if (averagePercentile >= minPercentileHealer && averagePercentile > 0) {
                        await handleRoleAssignment();
                        await interaction.editReply({ content: `Successfully verified, enjoy your stay` });
                    } else {
                        await interaction.editReply({ content: `Your performance does not meet our requirements. If you believe this is a mistake, you can contact an administrator.` });
                    }
                } else if (characterMetric.toLowerCase() == 'tank') {
                    if (averagePercentile >= minPercentileTank && averagePercentile > 0) {
                        await handleRoleAssignment();
                        await interaction.editReply({ content: `Successfully verified, enjoy your stay` });
                    } else {
                        await interaction.editReply({ content: `Your performance does not meet our requirements. If you believe this is a mistake, you can contact an administrator.` });
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
                    .setTitle('📋 No Logs Found')
                    .setDescription(`No logs found for character **"${characterName}"**`)
                    .addFields(
                        { name: 'Alternative Options', value: `• Post a screenshot in <#${alternativeVerificationChannelId}>\n• Contact <@380901972385071116> for assistance`, inline: false },
                        { name: 'Common Issues', value: '• Character name spelling\n• No recent raid logs', inline: false }
                    )
                    .setTimestamp();

                await interaction.editReply({ embeds: [noLogsEmbed] });

            }
        }
        
        // Absence command
        else if (interaction.commandName === 'absence') {
            await interaction.deferReply();

            if (!interaction.member.roles.cache.has(guildmemberRoleID)) {
                await interaction.editReply({
                    content: 'Only guild members can use this command.',
                    ephemeral: true
                });
                return;
            }
            
            // Get input parameters
            const startDate = interaction.options.getString('start');
            const endDate = interaction.options.getString('end');
            const reason = interaction.options.getString('reason') || 'Not specified';
            const characterName = interaction.options.getString('character');
            
            try {
                // Create a unique ID for this absence request
                const absenceId = Date.now().toString();
                
                // Store the absence request (pending approval)
                absences.set(interaction.user.id, {
                    id: absenceId,
                    userId: interaction.user.id,
                    username: interaction.user.tag,
                    characterName: characterName,
                    startDate: startDate,
                    endDate: endDate,
                    reason: reason,
                    approved: false,
                    requestedAt: new Date().toISOString()
                });
                
                // Get the pending absence channel
                const pendingChannel = bot.channels.cache.get(pendingAbsenceChannelId);
                
                if (!pendingChannel) {
                    console.error('Pending absence channel not found');
                    await interaction.editReply({ 
                        content: 'Could not submit absence for approval. Please contact an administrator.'
                    });
                    return;
                }
                
                // Create buttons for approval/denial
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
                
                // Create an embed for the pending absence
                const pendingEmbed = new Discord.EmbedBuilder()
                    .setColor('#FFCC00')
                    .setTitle('📋 Absence Request')
                    .setDescription(`A new absence request requires approval.`)
                    .addFields(
                        { name: '👤 User', value: interaction.user.tag, inline: false },
                        { name: '🎮 Character', value: characterName || 'Not specified', inline: false },
                        { name: '📅 Period', value: `**From:** ${startDate}\n**To:** ${endDate}`, inline: false },
                        { name: '📝 Reason', value: reason, inline: false }
                    )
                    .setTimestamp()
                    .setFooter({ text: `Request ID: ${absenceId}` });
                
                // Send the pending absence notification with buttons
                await pendingChannel.send({ 
                    content: `<@&${officerRoleId}> New absence request requires approval:`,
                    embeds: [pendingEmbed],
                    components: [row]
                });
                
                const confirmEmbed = new Discord.EmbedBuilder()
                    .setColor('#3498db')
                    .setTitle('📋 Absence Request Submitted')
                    .setDescription('Your request has been submitted and is pending officer approval.')
                    .addFields(
                        { name: '🎮 Character', value: characterName, inline: false },
                        { name: '📅 Period', value: `**From:** ${startDate}\n**To:** ${endDate}`, inline: false },
                        { name: '📝 Reason', value: reason, inline: false }
                    )
                    .setTimestamp()
                    .setFooter({ text: 'You will be notified when your request is reviewed' });

                await interaction.editReply({ embeds: [confirmEmbed] });
                
            } catch (error) {
                console.error('Error processing absence command:', error);
                await logErrorToDebugChannel(error, {
                    command: '/absence',
                    user: interaction.user.tag,
                    details: `Start: ${startDate}, End: ${endDate}, Character: ${characterName}`
                });
                await interaction.editReply({
                    content: 'An error occurred while processing your absence request. Please contact an administrator.'
                });
            }
        }

        // Debug command - officer only
        else if (interaction.commandName === 'debug') {
            await interaction.deferReply({ ephemeral: true });

            // Check if user has officer role
            if (!interaction.member.roles.cache.has(officerRoleId)) {
                await interaction.editReply({
                    content: 'This command is restricted to officers only.',
                    ephemeral: true
                });
                return;
            }

            characterName = interaction.options.getString('name');
            characterMetric = interaction.options.getString('role');
            characterClass = '';

            // Convert role input to metric
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
                case 'healer/hps':
                    characterMetricCheck = 'hps';
                    break;
                case 'tank':
                    characterMetricCheck = 'dps';
                    break;
                default:
                    await interaction.editReply({
                        content: 'Invalid role specified. Use: dps, healer, or tank',
                        ephemeral: true
                    });
                    return;
            }

            console.log(`[DEBUG] Character: ${characterName}, Role: ${characterMetricCheck}`);

            try {
                // Define the zone mapping
                const zoneNames = {
                    1036: 'Naxx',
                    1035: 'AQ40',
                    1034: 'BWL',
                    1028: 'MC'
                };

                // Track which zones were checked
                const zonesChecked = [];
                const zoneData = new Map();

                // Modified tryApiUrls to track zones
                const apiUrls = [
                    { zone: 1036, url: `https://fresh.warcraftlogs.com:443/v1/parses/character/${characterName}/${server}/${region}?zone=1036&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}` },
                    { zone: 1035, url: `https://fresh.warcraftlogs.com:443/v1/parses/character/${characterName}/${server}/${region}?zone=1035&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}` },
                    { zone: 1034, url: `https://fresh.warcraftlogs.com:443/v1/parses/character/${characterName}/${server}/${region}?zone=1034&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}` },
                    { zone: 1028, url: `https://fresh.warcraftlogs.com:443/v1/parses/character/${characterName}/${server}/${region}?zone=1028&metric=${characterMetricCheck}&includeCombatantInfo=false&api_key=${authorizationKey}` }
                ];

                let allData = [];

                // Try each API URL and track zones
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

                                // Extract class from first parse
                                if (!characterClass && data[0].class) {
                                    characterClass = data[0].class;
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
                        content: `No logs found for character **${characterName}**.\n\nZones checked: ${zonesChecked.join(', ')}`,
                        ephemeral: true
                    });
                    return;
                }

                // Get character details if class not found
                if (!characterClass) {
                    const characterDetails = await getCharacterDetails(characterName, authorizationKey);
                    if (characterDetails && characterDetails.class) {
                        characterClass = characterDetails.class;
                    }
                }

                // Calculate parses per encounter
                sumPercentiles = 0;
                entryCount = 0;
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

                // Build detailed parse info
                let parseDetails = '';
                encounterMap.forEach(entry => {
                    parseDetails += `${entry.encounterName}: ${entry.percentile.toFixed(1)}%\n`;
                });

                // Build zone breakdown
                let zoneBreakdown = '';
                zoneData.forEach((data, zoneName) => {
                    zoneBreakdown += `**${zoneName}**: ${data.length} logs\n`;
                });

                // Create debug embed
                const debugEmbed = new Discord.EmbedBuilder()
                    .setColor(getClassColor(characterClass))
                    .setTitle(`Debug Info: ${characterName}`)
                    .setDescription(`Detailed verification data for officer review`)
                    .addFields(
                        { name: 'Character Name', value: characterName, inline: true },
                        { name: 'Class', value: characterClass || 'Unknown', inline: true },
                        { name: 'Role Checked', value: getRoleEmoji(characterMetric) + ' ' + characterMetricCheck.toUpperCase(), inline: true },
                        { name: 'Zones Checked', value: zonesChecked.join(', '), inline: false },
                        { name: 'Zone Breakdown', value: zoneBreakdown || 'No data', inline: false },
                        { name: 'Total Encounters', value: entryCount.toString(), inline: true },
                        { name: 'Average Parse', value: `${averagePercentile.toFixed(1)}%`, inline: true },
                        { name: 'Parse Quality', value: getParseQuality(averagePercentile), inline: true }
                    )
                    .setTimestamp();

                // Add encounter details if we have them
                if (parseDetails) {
                    debugEmbed.addFields(
                        { name: 'Individual Parses', value: parseDetails.length > 1024 ? parseDetails.substring(0, 1020) + '...' : parseDetails, inline: false }
                    );
                }

                // Add verification status
                let verificationStatus = '';
                if (characterMetricCheck === 'dps' && characterMetric !== 'tank') {
                    verificationStatus = averagePercentile >= minPercentileDps ? `PASS (≥${minPercentileDps}%)` : `FAIL (<${minPercentileDps}%)`;
                } else if (characterMetric === 'healer' || characterMetric === 'hps') {
                    verificationStatus = averagePercentile >= minPercentileHealer ? `PASS (≥${minPercentileHealer}%)` : `FAIL (<${minPercentileHealer}%)`;
                } else if (characterMetric === 'tank') {
                    verificationStatus = averagePercentile >= minPercentileTank ? `PASS (≥${minPercentileTank}%)` : `FAIL (<${minPercentileTank}%)`;
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
                    characterName: characterName,
                    role: characterMetric,
                    details: 'Debug command failed'
                });
                await interaction.editReply({
                    content: `Error fetching debug data: ${error.message}`,
                    ephemeral: true
                });
            }
        }
    }

    // Handle button interactions
    if (interaction.isButton()) {
        const customId = interaction.customId;
        
        // Handle absence approval
        if (customId.startsWith('approve_absence_')) {
            // Check if user has permission to approve
            if (!interaction.member.roles.cache.has(officerRoleId)) {
                await interaction.reply({ 
                    content: 'You do not have permission to approve absence requests.',
                    ephemeral: true 
                });
                return;
            }
            
            const absenceId = customId.replace('approve_absence_', '');
            
            // Find the absence by ID
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
                // Mark as approved
                absenceData.approved = true;
                absences.set(userId, absenceData);
                
                // Get the member
                const member = await interaction.guild.members.fetch(userId);

                // Get the absence notification channel
                const absenceChannel = bot.channels.cache.get(absenceChannelId);
                
                // Create an embed for the approved absence notification
                const absenceEmbed = new Discord.EmbedBuilder()
                    .setColor('#00CC00')
                    .setTitle('✅ Absence Approved')
                    .addFields(
                        { name: '👤 User', value: absenceData.username, inline: false },
                        { name: '🎮 Character', value: absenceData.characterName || 'Not specified', inline: false },
                        { name: '📅 Period', value: `**From:** ${absenceData.startDate}\n**To:** ${absenceData.endDate}`, inline: false },
                        { name: '📝 Reason', value: absenceData.reason, inline: false },
                        { name: '✅ Approved By', value: interaction.user.tag, inline: false }
                    )
                    .setTimestamp();
                
                // Send the approved absence notification
                if (absenceChannel) {
                    await absenceChannel.send({ embeds: [absenceEmbed] });
                }
                
                // Update the original message
                await interaction.update({ 
                    content: `Absence request for **${absenceData.username}** has been approved by ${interaction.user.tag}.`,
                    components: [] // Remove the buttons
                });
                
                // Notify the user
                try {
                    await member.send(`Your absence request from ${absenceData.startDate} to ${absenceData.endDate} has been approved.`);
                } catch (dmError) {
                    console.log(`Could not DM ${member.user.tag}: ${dmError.message}`);
                }
                
                // Log in debug channel
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
            // Check if user has permission to deny
            if (!interaction.member.roles.cache.has(officerRoleId)) {
                await interaction.reply({ 
                    content: 'You do not have permission to deny absence requests.',
                    ephemeral: true 
                });
                return;
            }
            
            const absenceId = customId.replace('deny_absence_', '');
            
            // Find the absence by ID
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
                // Remove from tracking
                absences.delete(userId);
                
                // Update the original message
                await interaction.update({ 
                    content: `Absence request for **${absenceData.username}** has been denied by ${interaction.user.tag}.`,
                    components: [] // Remove the buttons
                });
                
                // Get the member and notify them
                try {
                    const member = await interaction.guild.members.fetch(userId);
                    await member.send(`Your absence request from ${absenceData.startDate} to ${absenceData.endDate} has been denied.`);
                } catch (memberError) {
                    console.log(`Could not notify member ${userId}: ${memberError.message}`);
                }
                
                // Log in debug channel
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

// Bot ready event
bot.once('ready', async () => {
    try {
        // Register the verify command
        await bot.application.commands.create({
            name: 'verify',
            description: "Verify yourself",
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
        
        // Register the absence command with additional parameters
        await bot.application.commands.create({
            name: 'absence',
            description: 'Report a period of absence',
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

        // Register the debug command - officer only
        await bot.application.commands.create({
            name: 'debug',
            description: '[OFFICERS ONLY] Debug character verification (no role assignment)',
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

        console.log('Bot is ready and commands registered');

    } catch (error) {
        console.error('Error registering commands:', error);
        await logErrorToDebugChannel(error, {
            details: 'Failed to register slash commands on bot startup'
        });
    }
});

// Login with retry logic for network issues
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

            // Check if it's a network error
            const isNetworkError = error.code === 'EAI_AGAIN' ||
                                   error.code === 'ENOTFOUND' ||
                                   error.code === 'ETIMEDOUT' ||
                                   error.code === 'ECONNREFUSED';

            if (isNetworkError && retries < maxRetries) {
                const delay = initialDelay * Math.pow(2, retries - 1); // Exponential backoff
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
