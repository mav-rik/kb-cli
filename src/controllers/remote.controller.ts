import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { RemoteClient } from '../services/remote-client.js'

@Controller('remote')
export class RemoteController {
  private get remoteConfig() { return services.remoteConfig }
  private get wikiMgmt() { return services.wikiManagement }
  private client = new RemoteClient()

  @Cli('add/:name')
  @Description('Register a remote KB')
  add(
    @Param('name') name: string,
    @Description('Remote URL (e.g., http://host:4141)') @CliOption('url') url: string,
    @Description('Auth token') @CliOption('pat') @Optional() pat: string,
  ): string {
    if (this.remoteConfig.getRemote(name)) {
      return `Error: Remote "${name}" already registered.`
    }
    this.remoteConfig.addRemote(name, url, pat || undefined)
    return `Remote "${name}" registered at ${url}`
  }

  @Cli('remove/:name')
  @Description('Unregister a remote KB (keeps remote data)')
  remove(@Param('name') name: string): string {
    if (!this.remoteConfig.getRemote(name)) {
      return `Error: Remote "${name}" not found.`
    }
    this.remoteConfig.removeRemote(name)
    return `Remote "${name}" unregistered. (Remote data is preserved.)`
  }

  @Cli('list')
  @Description('List registered remote KBs')
  list(): string {
    const remotes = this.remoteConfig.listRemotes()
    if (remotes.length === 0) {
      return 'No remote KBs registered.'
    }
    const lines = ['Name | URL | Attached Wikis', '-----|-----|---------------']
    for (const r of remotes) {
      lines.push(`${r.name} | ${r.url} | ${r.wikiCount}`)
    }
    return lines.join('\n')
  }

  @Cli('connect/:name')
  @Description('Test connection to a remote KB')
  async connect(@Param('name') name: string): Promise<string> {
    const remote = this.remoteConfig.getRemote(name)
    if (!remote) return `Error: Remote "${name}" not found.`

    try {
      await this.client.health(remote.url, remote.pat)
      return `Connected to "${name}" at ${remote.url} — OK`
    } catch (err: any) {
      return `Error: Cannot connect to "${name}" at ${remote.url}: ${err.message}`
    }
  }

  @Cli('wikis/:name')
  @Description('List wikis available on a remote KB')
  async wikis(@Param('name') name: string): Promise<string> {
    const remote = this.remoteConfig.getRemote(name)
    if (!remote) return `Error: Remote "${name}" not found.`

    try {
      const wikis = await this.client.listWikis(remote.url, remote.pat)
      if (wikis.length === 0) return `No wikis on remote "${name}".`

      const attached = Object.keys(remote.attachedWikis)
      const lines = wikis.map(w => {
        const status = attached.includes(w) ? ' (attached)' : ''
        return `  ${w}${status}`
      })
      return [`Wikis on "${name}":`, ...lines].join('\n')
    } catch (err: any) {
      return `Error: ${err.message}`
    }
  }

  @Cli('attach/:kbName/:wikiName')
  @Description('Attach a remote wiki for local use')
  attach(
    @Param('kbName') kbName: string,
    @Param('wikiName') wikiName: string,
    @Description('Local alias') @CliOption('alias', 'a') @Optional() alias: string,
  ): string {
    const localName = alias || wikiName

    if (this.wikiMgmt.exists(localName)) {
      return `Error: Name "${localName}" conflicts with a local wiki. Use --alias to pick a different name.`
    }

    const result = this.remoteConfig.attachWiki(kbName, wikiName, alias || undefined)
    if (result.error) return `Error: ${result.error}`

    const aliasInfo = alias ? ` (alias: ${alias})` : ''
    return `Attached "${kbName}/${wikiName}"${aliasInfo}. Use with: kb search "query" --wiki ${localName}`
  }

  @Cli('detach/:name')
  @Description('Detach a remote wiki')
  detach(@Param('name') name: string): string {
    const result = this.remoteConfig.detachWiki(name)
    if (result.error) return `Error: ${result.error}`
    return `Detached "${name}".`
  }

  @Cli('create-wiki/:kbName/:wikiName')
  @Description('Create a new wiki on a remote KB')
  async createWiki(
    @Param('kbName') kbName: string,
    @Param('wikiName') wikiName: string,
    @Description('Local alias') @CliOption('alias', 'a') @Optional() alias: string,
  ): Promise<string> {
    const remote = this.remoteConfig.getRemote(kbName)
    if (!remote) return `Error: Remote "${kbName}" not found.`

    try {
      await this.client.createWiki(remote.url, wikiName, remote.pat)
    } catch (err: any) {
      return `Error: ${err.message}`
    }

    const localName = alias || wikiName
    if (this.wikiMgmt.exists(localName)) {
      return `Created wiki "${wikiName}" on "${kbName}" but cannot attach: name conflicts with local wiki. Use: kb remote attach ${kbName} ${wikiName} --alias <name>`
    }

    this.remoteConfig.attachWiki(kbName, wikiName, alias || undefined)
    return `Created and attached "${kbName}/${wikiName}" as "${localName}".`
  }

  @Cli('delete-wiki/:kbName/:wikiName')
  @Description('Delete a wiki on a remote KB (destructive!)')
  async deleteWiki(
    @Param('kbName') kbName: string,
    @Param('wikiName') wikiName: string,
    @Description('Confirm deletion') @CliOption('force') force: boolean,
  ): Promise<string> {
    if (!force) {
      return `This will PERMANENTLY DELETE wiki "${wikiName}" on remote "${kbName}".\nRe-run with --force to confirm.`
    }

    const remote = this.remoteConfig.getRemote(kbName)
    if (!remote) return `Error: Remote "${kbName}" not found.`

    try {
      await this.client.deleteWiki(remote.url, wikiName, remote.pat)
    } catch (err: any) {
      return `Error: ${err.message}`
    }

    if (remote.attachedWikis[wikiName]) {
      const localName = remote.attachedWikis[wikiName].alias || wikiName
      this.remoteConfig.detachWiki(localName)
    }

    return `Deleted wiki "${wikiName}" on remote "${kbName}".`
  }
}
