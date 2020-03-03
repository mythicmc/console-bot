import Eris from 'eris'
import WebSocket from 'ws'
import fetch from 'node-fetch'
import { inspect } from 'util'
import { readFileSync } from 'fs'

const config = JSON.parse(readFileSync('./config.json', { encoding: 'utf8' }))

const client = new Eris.Client(config.token, { restMode: true, autoreconnect: true })

client.connect()

class MessageBuffer {
  buffer = ''

  get length() { return this.buffer.length }

  push(message) {
    this.buffer += message + '\n'
    return true
  }

  flush(length) {
    const r = this.buffer.substr(0, length)
    this.buffer = this.buffer.substr(length)
    return r
  }
}

const channelLinksMap = []

client.on('error', (err, id) => console.error(`Error: ${inspect(err, false, 0)}\nShard ID: ${id}`))

client.on('ready', () => console.log('Connected to Discord!'))

client.once('ready', async () => {
  const guild = client.guilds.get(config.guild)
  if (!guild) {
    console.error('The specified guild does not exist! Shutting down the bot..')
    client.disconnect({ reconnect: false })
    return
  }

  const channels = guild.channels.filter(channel => (
    Object.keys(config.channels).includes(channel.id) && channel.permissionsOf(client.user.id).has(
      'sendMessages'
    )
  ))
  if (channels.length != Object.keys(config.channels).length) {
    console.error('Some of the channels specified in config do not exist/no perms to send messages!'
      + ' Shutting down the bot..')
    client.disconnect({ reconnect: false })
    return
  }

  // Authenticate with octyne.
  let token = ''
  try {
    const r = await (await fetch(`${config.ip}/login`, { headers: {
      Username: config.username,
      Password: config.password
    } })).json()
    if (r.error) throw new Error(r.error)
    else token = r.token
  } catch (e) {
    console.error(e)
    client.disconnect({ reconnect: false })
    return
  }

  // Create WebSocket connections.
  channels.forEach(channel => {
    const ws = new WebSocket(
      `${config.ip}/server/${config.channels[channel.id]}/console`,
      { headers: { Authorization: token } }
    )
    const buffer = new MessageBuffer()
    ws.on('error', err => console.error(err))
    let first = true
    ws.on('message', data => {
      if (first) {
        first = false
        return
      } else buffer.push(data)
    })
    const interval = setInterval(() => {
      const flush = buffer.flush(2000)
      /*
      if (flush.length + buffer.length > 10000) {
        const file = flush + buffer.flush(8000)
        channel.createMessage(
          'Message buffer too large! File:',
          { name: `${new Date().toISOString()}.txt`, file }
        )
      } else */ if (flush.length) channel.createMessage(flush.replace(/>\r/g, '>'))
    }, 1000)
    channelLinksMap.push({ channel, ws, buffer, interval })
  })
  console.log('Initialized all connections to Octyne!')
})

client.on('messageCreate', message => {
  channelLinksMap.forEach((value) => {
    if (value.channel.id === message.channel.id && !message.author.bot) value.ws.send(message.content)
  })
})
