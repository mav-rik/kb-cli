import { Controller, Cli, Param, CliOption, Description, Optional } from '@moostjs/event-cli'
import { services } from '../services/container.js'
import { RemoteClient } from '../services/remote-client.js'

@Controller('remote')
export class RemoteController {
  private get remoteConfig() { return services.remoteConfig }
  private get wikiMgmt() { return services.wikiManagement }
  private client = new RemoteClient()

  @Cli('add/:name')
  @Description('Register a remote kb server under a local name. Stores the URL (and optional secret) in ~/.kb/remotes.json. After registering, use `kb remote wikis <name>` to discover wikis and `kb remote attach` to expose them locally.')
  add(
    @Description('Local nickname for this remote (your choice — does not have to match anything on the server). Used as the handle for all subsequent `kb remote` subcommands.') @Param('name') name: string,
    @Description('Base URL of the remote `kb serve` instance, e.g. `http://host:4141`. No trailing path.') @CliOption('url') url: string,
    @Description('Bearer token. Set this if the remote was started with `kb serve --secret <token>`; omit otherwise.') @CliOption('secret') @Optional() secret: string,
  ): string {
    if (this.remoteConfig.getRemote(name)) {
      return `Error: Remote "${name}" already registered.`
    }
    this.remoteConfig.addRemote(name, url, secret || undefined)
    return `Remote "${name}" registered at ${url}`
  }

  @Cli('remove/:name')
  @Description('Forget a registered remote. Detaches any attached wikis and removes the entry from ~/.kb/remotes.json. Does NOT touch the remote server itself — to delete wikis on the remote, use `kb remote delete-wiki`.')
  remove(@Description('Local nickname of the remote to forget.') @Param('name') name: string): string {
    if (!this.remoteConfig.getRemote(name)) {
      return `Error: Remote "${name}" not found.`
    }
    this.remoteConfig.removeRemote(name)
    return `Remote "${name}" unregistered. (Remote data is preserved.)`
  }

  @Cli('list')
  @Description('Print every registered remote: nickname, URL, and how many wikis from it are attached locally. Run `kb remote wikis <name>` to discover wikis on a specific remote.')
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
  @Description('Health-check a registered remote. Calls GET /api/health and reports success or the underlying error. Useful for debugging "remote wikis return nothing" or "search fails" scenarios.')
  async connect(@Description('Local nickname of the remote to probe.') @Param('name') name: string): Promise<string> {
    const remote = this.remoteConfig.getRemote(name)
    if (!remote) return `Error: Remote "${name}" not found.`

    try {
      await this.client.health(remote.url, remote.secret)
      return `Connected to "${name}" at ${remote.url} — OK`
    } catch (err: any) {
      return `Error: Cannot connect to "${name}" at ${remote.url}: ${err.message}`
    }
  }

  @Cli('wikis/:name')
  @Description('List every wiki on the remote server. Wikis already attached locally are flagged with "(attached)". Use this to see what is available before running `kb remote attach`.')
  async wikis(@Description('Local nickname of the remote to query.') @Param('name') name: string): Promise<string> {
    const remote = this.remoteConfig.getRemote(name)
    if (!remote) return `Error: Remote "${name}" not found.`

    try {
      const wikis = await this.client.listWikis(remote.url, remote.secret)
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
  @Description('Expose a remote wiki under a local name so commands like `kb search --wiki <name>` can target it transparently. Use --alias when the remote\'s wiki name collides with a local wiki.')
  attach(
    @Description('Local nickname of the registered remote (from `kb remote add`).') @Param('kbName') kbName: string,
    @Description('Wiki name on the remote server. Run `kb remote wikis <kbName>` to discover available names.') @Param('wikiName') wikiName: string,
    @Description('Local alias for the attached wiki. Required when the remote wiki name collides with a local wiki or another attached wiki.') @CliOption('alias', 'a') @Optional() alias: string,
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
  @Description('Stop exposing a remote wiki locally. Removes the attachment from ~/.kb/remotes.json — the remote wiki itself is untouched and can be re-attached later.')
  detach(@Description('Local name (or alias) of the attached wiki to detach.') @Param('name') name: string): string {
    const result = this.remoteConfig.detachWiki(name)
    if (result.error) return `Error: ${result.error}`
    return `Detached "${name}".`
  }

  @Cli('create-wiki/:kbName/:wikiName')
  @Description('Create a wiki on a remote server (calls POST /api/wiki) and auto-attach it locally in one step. If the local name collides, the wiki is created but not attached; re-run `kb remote attach` with --alias.')
  async createWiki(
    @Description('Local nickname of the registered remote.') @Param('kbName') kbName: string,
    @Description('Wiki name to create on the remote. Must satisfy the WikiName constraints (letters/digits/dashes/underscores, 1-64 chars).') @Param('wikiName') wikiName: string,
    @Description('Local alias for the newly-attached wiki. Required if `wikiName` collides with an existing local or attached wiki.') @CliOption('alias', 'a') @Optional() alias: string,
  ): Promise<string> {
    const remote = this.remoteConfig.getRemote(kbName)
    if (!remote) return `Error: Remote "${kbName}" not found.`

    try {
      await this.client.createWiki(remote.url, wikiName, remote.secret)
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
  @Description('PERMANENTLY delete a wiki on a remote server. Two-step safety: without --force, prints the warning and exits without acting. Also auto-detaches the wiki locally if it was attached. Irreversible on the remote.')
  async deleteWiki(
    @Description('Local nickname of the registered remote.') @Param('kbName') kbName: string,
    @Description('Wiki name on the remote to delete.') @Param('wikiName') wikiName: string,
    @Description('Required to actually perform the deletion. Without --force, the command is a no-op safety preview.') @CliOption('force') force: boolean,
  ): Promise<string> {
    if (!force) {
      return `This will PERMANENTLY DELETE wiki "${wikiName}" on remote "${kbName}".\nRe-run with --force to confirm.`
    }

    const remote = this.remoteConfig.getRemote(kbName)
    if (!remote) return `Error: Remote "${kbName}" not found.`

    try {
      await this.client.deleteWiki(remote.url, wikiName, remote.secret)
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
