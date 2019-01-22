import { v4 as uuidv4 } from 'uuid'
import logger from './util/logger'
import Connection from './Connection'
import Dialog from './rtc/Dialog'
import {
  ISignalWireOptions, SubscribeParams, BroadcastParams, ICacheDevices, IAudioSettings, IVideoSettings
} from './interfaces'
import { validateOptions } from './util/helpers'
import { register, deRegister, trigger, registerOnce } from './services/Handler'
import { SwEvent, NOTIFICATION_TYPE } from './util/constants'
import {
  getDevices, getResolutions, checkPermissions, removeUnsupportedConstraints, checkDeviceIdConstraints
} from './services/RTCService'

export default abstract class BaseSession {
  public uuid: string = uuidv4()
  public sessionid: string = ''
  public dialogs: { [dialogId: string]: Dialog } = {}
  public subscriptions: { [channel: string]: any } = {}
  private _iceServers: RTCIceServer[] = []

  protected _connection: Connection = null
  protected _devices: ICacheDevices = {}

  protected _audioConstraints: boolean | MediaTrackConstraints = true
  protected _videoConstraints: boolean | MediaTrackConstraints = false

  constructor(public options: ISignalWireOptions) {
    if (!validateOptions(options, this.constructor.name)) {
      throw new Error('Invalid options for ' + this.constructor.name)
    }
    this.on(SwEvent.SocketOpen, this._onSocketOpen.bind(this))
    this.on(SwEvent.SocketClose, this._onSocketClose.bind(this))
    this.on(SwEvent.SocketError, this._onSocketError.bind(this))
    this.on(SwEvent.SocketMessage, this._onSocketMessage.bind(this))

    this.iceServers = true
  }

  abstract async subscribe(params: SubscribeParams): Promise<any>
  abstract async unsubscribe(params: SubscribeParams): Promise<any>
  abstract broadcast(params: BroadcastParams): void

  async connect(): Promise<void> {
    if (this._connection && this._connection.connected) {
      logger.warn('Session already connected')
      return
    } else {
      this.disconnect()
    }

    const permissionPromise = checkPermissions()
    const devicePromise = this.refreshDevices()

    const success = await permissionPromise
    await devicePromise

    this._connection = new Connection(this)

    if (!success) {
      trigger(SwEvent.Notification, { type: NOTIFICATION_TYPE.userMediaError, error: 'Permission denied' }, this.uuid)
    }
  }

  disconnect() {
    this.subscriptions = {}
    this.dialogs = {}
    if (this._connection) {
      this._connection.close()
    }
    this._connection = null
  }

  on(eventName: string, callback: Function) {
    register(eventName, callback, this.uuid)
  }

  off(eventName: string, callback?: Function) {
    deRegister(eventName, callback, this.uuid)
  }

  execute(msg: any) {
    return this._connection.send(msg)
  }

  speedTest(bytes: number) {
    return new Promise((resolve, reject) => {
      registerOnce(SwEvent.SpeedTest, speedTestResult => {
        const { upDur, downDur } = speedTestResult
        const upKps = upDur ? (( (bytes * 8) / (upDur / 1000)) / 1024) : 0
        const downKps = downDur ? (( (bytes * 8) / (downDur / 1000)) / 1024) : 0
        resolve({ upDur, downDur, upKps: upKps.toFixed(0), downKps: downKps.toFixed(0) })
      }, this.uuid)

      bytes = Number(bytes)
      if (!bytes) {
        return reject(`Invalid parameter 'bytes': ${bytes}`)
      }

      this._connection.sendRawText(`#SPU ${bytes}`)
      let loops = bytes / 1024
      if (bytes % 1024) {
        loops++
      }
      const dots = '.'.repeat(1024)
      for (let i = 0; i < loops; i++) {
        this._connection.sendRawText(`#SPB ${dots}`)
      }
      this._connection.sendRawText('#SPE')
    })
  }

  async refreshDevices() {
    this._devices = await getDevices()
    return Object.assign({}, this._devices)
  }

  get videoDevices() {
    return this._devices.videoinput
  }

  get audioInDevices() {
    return this._devices.audioinput
  }

  get audioOutDevices() {
    return this._devices.audiooutput
  }

  get mediaConstraints() {
    return { audio: this._audioConstraints, video: this._videoConstraints }
  }

  async setAudioSettings(settings: IAudioSettings) {
    const { micId, micLabel, ...constraints } = settings
    removeUnsupportedConstraints(constraints)
    this._audioConstraints = await checkDeviceIdConstraints(micId, micLabel, 'audioinput', constraints)
    return this._audioConstraints
  }

  disableMicrophone() {
    this._audioConstraints = false
  }

  enableMicrophone() {
    this._audioConstraints = true
  }

  async setVideoSettings(settings: IVideoSettings) {
    const { camId, camLabel, ...constraints } = settings
    removeUnsupportedConstraints(constraints)
    this._videoConstraints = await checkDeviceIdConstraints(camId, camLabel, 'videoinput', constraints)
    return this._videoConstraints
  }

  disableWebcam() {
    this._videoConstraints = false
  }

  enableWebcam() {
    this._videoConstraints = true
  }

  supportedResolutions() {
    return getResolutions()
  }

  set iceServers(servers: RTCIceServer[] | boolean) {
    if (typeof servers === 'boolean') {
      this._iceServers = servers ? [{ urls: ['stun:stun.l.google.com:19302'] }] : []
    } else {
      this._iceServers = servers
    }
  }

  get iceServers() {
    return this._iceServers
  }

  protected abstract _onSocketOpen(): void
  protected abstract _onSocketClose(): void
  protected abstract _onSocketError(error): void
  protected abstract _onSocketMessage(response): void

  static on(eventName: string, callback: any) {
    register(eventName, callback)
  }

  static off(eventName: string) {
    deRegister(eventName)
  }

  static uuid(): string {
    return uuidv4()
  }
}
