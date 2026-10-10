import { Routes, SlashCommandBuilder } from 'discord.js';

export const keyCommand = new SlashCommandBuilder().setName('key').setDescription('Your Dauntless Revived access code')
  .setContexts(0, 1)
  .addSubcommand(option => option.setName('resend').setDescription('Resend your saved unused invite privately; never creates another'))
  .addSubcommand(option => option.setName('recover').setDescription('Privately rotate your verified linked account key').addStringOption(value=>value.setName('confirm').setDescription('Your private five-minute recovery challenge').setMinLength(64).setMaxLength(64)))
  .addSubcommand(option => option.setName('claim').setDescription('Receive your launcher invite by direct message'))
  .addSubcommand(option => option.setName('status').setDescription('Check your account link or code redemption'))
  .addSubcommand(option => option.setName('link').setDescription('Link your existing account using its saved account key, not a Join invite')
    .addStringOption(value => value.setName('key').setDescription('Settings > Save a backup of your key > copy the Key: value (not your Join invite)').setRequired(true).setMinLength(8).setMaxLength(2048)))
  .toJSON();

// Do not advertise rotation until its separately authenticated backend is configured.
if (!process.env.KEY_RECOVERY_SERVICE_SECRET) {
  keyCommand.options = keyCommand.options.filter(option => option.name !== 'recover');
}

function optionShape(option) {
  return {type:option.type, name:option.name, description:option.description,
    required:option.required ?? false, min_length:option.min_length ?? null, max_length:option.max_length ?? null,
    options:(option.options ?? []).map(optionShape)};
}
function shape(command, guild) {
  return {...optionShape(command), type:command.type ?? 1,
    contexts:guild ? [] : [...(command.contexts ?? [])].sort()};
}

// Preserve command IDs and other commands. Avoid POST on every restart: clients cache versions.
export async function syncKeyCommands(rest, applicationId, guildIds = []) {
  const route = Routes.applicationCommands(applicationId);
  const existing = (await rest.get(route)).find(command=>command.name==='key' && command.type===1);
  let changed = 0;
  if (!existing || JSON.stringify(shape(existing,false))!==JSON.stringify(shape(keyCommand,false))) {
    if (existing) await rest.patch(`${route}/${existing.id}`,{body:keyCommand});
    else await rest.post(route,{body:keyCommand});
    changed++;
  }
  // One global command serves both guilds and DMs; remove only our old guild copies.
  for (const id of new Set(guildIds)) {
    const guildRoute=Routes.applicationGuildCommands(applicationId,id);
    for (const command of await rest.get(guildRoute)) {
      if (command.name==='key' && command.type===1) {
        await rest.delete(`${guildRoute}/${command.id}`);
        changed++;
      }
    }
  }
  return changed;
}
