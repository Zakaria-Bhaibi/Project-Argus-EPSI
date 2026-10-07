// English / French. The language is a module-level value so plain helpers (nodeLabel, formatters) can read it;
// App subscribes with useLang() so the whole console re-renders when it changes.
import { useSyncExternalStore } from 'react'

const LANGS = ['en', 'fr']
const listeners = new Set()

function initial() {
  try {
    const saved = localStorage.getItem('argus.lang')
    if (LANGS.includes(saved)) return saved
  } catch { /* private mode */ }
  return navigator.language?.toLowerCase().startsWith('fr') ? 'fr' : 'en'
}

let lang = initial()
document.documentElement.lang = lang

export const getLang = () => lang
export function setLang(next) {
  if (!LANGS.includes(next) || next === lang) return
  lang = next
  document.documentElement.lang = next
  try { localStorage.setItem('argus.lang', next) } catch { /* private mode */ }
  listeners.forEach((l) => l())
}
export function useLang() {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l) }, getLang)
}

// locale for dates and times: French uses fr-FR, English keeps the browser's own format
export const locale = () => (lang === 'fr' ? 'fr-FR' : undefined)

const STRINGS = {
  en: {
    'site.name': 'Outpost K-7',
    'site.region': 'Kerguelen plateau',
    'node.sentinel-hero': 'Control hut',
    'node.sentinel-01': 'North gate',
    'node.sentinel-02': 'Gas manifold',
    'node.sentinel-03': 'Turbine hall',
    'node.sentinel-04': 'Battery store',

    'lang.label': 'Language',
    'login.sub': '{site} supervision console',
    'login.username': 'Username',
    'login.password': 'Password',
    'login.wrong': 'Wrong username or password.',
    'login.busy': 'Signing in…',
    'login.submit': 'Sign in',

    'top.reporting': '{online} of {total} nodes reporting',
    'top.live': 'Live',
    'top.reconnecting': 'Reconnecting…',
    'top.alarm': '🔊 Alarm sounding',
    'top.soundOn': '🔊 Sound on',
    'top.soundOff': '🔇 Sound off',
    'top.signOut': 'Sign out',
    'situation.clear': 'All clear across the site',
    'map.label': 'Site map',
    'map.legend': 'Map legend',
    'legend.online': 'Reporting',
    'legend.down': 'Silent',
    'legend.environmental': 'Environmental alert',
    'legend.intrusion': 'Intrusion alert',
    'legend.cyber': 'Cyber alert',
    'legend.packet': 'Message in flight',
    'sr.showing': 'Showing {node}',

    'pin.gasWarming': 'gas warming up',
    'pin.noData': 'no data',
    'hazard.gas': 'Gas leak {ppm} ppm',
    'hazard.heat': 'Overheat {temp} °C',
    'hazard.intruder': 'Intruder detected',

    'drill.attack': 'Under attack',
    'drill.defend': 'Defenses engaged',
    'drill.blocked': 'Attack blocked',

    'timeline.title': 'Threat timeline',
    'timeline.sinceClear': 'Since all clear',
    'timeline.earlier': 'Show earlier',
    'timeline.filters': 'Show categories',
    'timeline.empty': 'All clear. Alerts from sensors, the camera and the network appear here as they happen.',
    'timeline.from': 'from {ip}',
    'timeline.as': 'as “{user}”',
    'cat.environmental': 'Environment',
    'cat.intrusion': 'Intrusion',
    'cat.cyber': 'Cyber',
    'cat.system': 'System',
    'sev.critical': 'critical',
    'sev.warning': 'warning',
    'sev.info': 'info',

    'node.empty': 'Select a node on the map to see its live readings and controls.',
    'node.readings': 'Readings for {node}',
    'status.online': 'Online',
    'status.silent': 'Not reporting',
    'status.offline': 'Offline',
    'status.unknown': 'Waiting for data',
    'node.simulated': 'Simulated node',
    'node.firmware': 'ESP32 firmware (Wokwi)',
    'node.traffic': 'Traffic {msgs} msg / 10 s',
    'node.motion': 'Motion',
    'spark.temp': 'Temperature',
    'spark.gas': 'Gas',
    'spark.anomaly': 'Anomaly score',
    'spark.alarm': 'alarm',

    'controls.title': 'Controls',
    'controls.viewer': 'Viewer accounts can watch but not act. Sign in as an operator to send commands.',
    'controls.simulate': 'Simulate an incident',
    'inc.gas': 'Gas leak',
    'inc.heat': 'Overheat',
    'inc.intruder': 'Send intruder',
    'inc.cyber': 'Cyber attack',
    'inc.stopCyber': 'Stop cyber attack',
    'inc.clear': 'All clear',
    'controls.noNode': 'No node selected',
    'controls.notReporting': '{node} is not reporting, so it can\'t receive commands.',
    'controls.offline': '{node} is offline, so it can\'t receive commands.',
    'controls.startWokwi': ' Start the Wokwi simulator to bring it online.',
    'controls.siren': 'Siren',
    'controls.stopSiren': 'Stop siren',
    'controls.soundSiren': 'Sound siren',
    'controls.light': 'Status light',
    'led.green': 'Green',
    'led.orange': 'Orange',
    'led.red': 'Red',
    'led.off': 'Off',
    'controls.screen': 'Screen message',
    'controls.screenPlaceholder': 'Evacuate north gate',
    'controls.show': 'Show',
    'note.confirmed': 'Confirmed by {node}',
    'note.noConfirm': '{node} did not confirm. Is it online?',
    'note.sent': 'Sent. Waiting for {node} to confirm…',
    'note.started': '{incident} started at {node}',
    'note.allClear': 'All clear: scenarios stopped, sirens off, lights green',

    'camera.label': 'Site camera',
    'camera.title': 'Mast camera',
    'camera.tracking': 'TRACKING',
    'camera.patrol': 'PATROL',
    'camera.person': 'person',
    'camera.srTracking': 'Camera tracking a detected intruder',
    'camera.srPatrol': 'Camera patrolling',

    'error.request': 'Request failed ({status})',
    'error.slowDown': 'Too many requests. Wait a moment and try again.',
  },
  fr: {
    'site.name': 'Avant-poste K-7',
    'site.region': 'plateau des Kerguelen',
    'node.sentinel-hero': 'Poste de contrôle',
    'node.sentinel-01': 'Portail nord',
    'node.sentinel-02': 'Collecteur de gaz',
    'node.sentinel-03': 'Salle des turbines',
    'node.sentinel-04': 'Local batteries',

    'lang.label': 'Langue',
    'login.sub': 'Console de supervision {site}',
    'login.username': 'Identifiant',
    'login.password': 'Mot de passe',
    'login.wrong': 'Identifiant ou mot de passe incorrect.',
    'login.busy': 'Connexion…',
    'login.submit': 'Se connecter',

    'top.reporting': '{online} capteurs sur {total} actifs',
    'top.live': 'En direct',
    'top.reconnecting': 'Reconnexion…',
    'top.alarm': '🔊 Alarme en cours',
    'top.soundOn': '🔊 Son activé',
    'top.soundOff': '🔇 Son coupé',
    'top.signOut': 'Se déconnecter',
    'situation.clear': 'RAS sur l\'ensemble du site',
    'map.label': 'Plan du site',
    'map.legend': 'Légende du plan',
    'legend.online': 'Actif',
    'legend.down': 'Muet',
    'legend.environmental': 'Alerte environnementale',
    'legend.intrusion': 'Alerte intrusion',
    'legend.cyber': 'Alerte cyber',
    'legend.packet': 'Message en transit',
    'sr.showing': 'Affichage : {node}',

    'pin.gasWarming': 'capteur gaz en chauffe',
    'pin.noData': 'aucune donnée',
    'hazard.gas': 'Fuite de gaz {ppm} ppm',
    'hazard.heat': 'Surchauffe {temp} °C',
    'hazard.intruder': 'Intrus détecté',

    'drill.attack': 'Attaque en cours',
    'drill.defend': 'Défenses activées',
    'drill.blocked': 'Attaque bloquée',

    'timeline.title': 'Chronologie des menaces',
    'timeline.sinceClear': 'Depuis le dernier RAS',
    'timeline.earlier': 'Voir l\'historique',
    'timeline.filters': 'Catégories affichées',
    'timeline.empty': 'RAS. Les alertes des capteurs, de la caméra et du réseau s\'affichent ici en temps réel.',
    'timeline.from': 'depuis {ip}',
    'timeline.as': 'en tant que « {user} »',
    'cat.environmental': 'Environnement',
    'cat.intrusion': 'Intrusion',
    'cat.cyber': 'Cyber',
    'cat.system': 'Système',
    'sev.critical': 'critique',
    'sev.warning': 'avertissement',
    'sev.info': 'info',

    'node.empty': 'Sélectionnez un capteur sur le plan pour voir ses relevés en direct et ses commandes.',
    'node.readings': 'Relevés : {node}',
    'status.online': 'En ligne',
    'status.silent': 'Muet',
    'status.offline': 'Hors ligne',
    'status.unknown': 'En attente de données',
    'node.simulated': 'Capteur simulé',
    'node.firmware': 'Firmware ESP32 (Wokwi)',
    'node.traffic': 'Trafic {msgs} msg / 10 s',
    'node.motion': 'Mouvement',
    'spark.temp': 'Température',
    'spark.gas': 'Gaz',
    'spark.anomaly': 'Score d\'anomalie',
    'spark.alarm': 'alarme',

    'controls.title': 'Commandes',
    'controls.viewer': 'Les comptes observateur peuvent consulter sans agir. Connectez-vous en opérateur pour envoyer des commandes.',
    'controls.simulate': 'Simuler un incident',
    'inc.gas': 'Fuite de gaz',
    'inc.heat': 'Surchauffe',
    'inc.intruder': 'Envoyer un intrus',
    'inc.cyber': 'Cyberattaque',
    'inc.stopCyber': 'Arrêter la cyberattaque',
    'inc.clear': 'Fin d\'alerte',
    'controls.noNode': 'Aucun capteur sélectionné',
    'controls.notReporting': '{node} n\'émet plus et ne peut donc pas recevoir de commandes.',
    'controls.offline': '{node} est hors ligne et ne peut donc pas recevoir de commandes.',
    'controls.startWokwi': ' Lancez le simulateur Wokwi pour le remettre en ligne.',
    'controls.siren': 'Sirène',
    'controls.stopSiren': 'Arrêter la sirène',
    'controls.soundSiren': 'Déclencher la sirène',
    'controls.light': 'Voyant',
    'led.green': 'Vert',
    'led.orange': 'Orange',
    'led.red': 'Rouge',
    'led.off': 'Éteint',
    'controls.screen': 'Message écran',
    'controls.screenPlaceholder': 'Évacuez portail nord',
    'controls.show': 'Afficher',
    'note.confirmed': 'Confirmé par {node}',
    'note.noConfirm': '{node} n\'a pas confirmé. Est-il en ligne ?',
    'note.sent': 'Envoyé. En attente de confirmation de {node}…',
    'note.started': 'Scénario « {incident} » lancé sur {node}',
    'note.allClear': 'Fin d\'alerte : scénarios arrêtés, sirènes coupées, voyants au vert',

    'camera.label': 'Caméra du site',
    'camera.title': 'Caméra du mât',
    'camera.tracking': 'SUIVI',
    'camera.patrol': 'PATROUILLE',
    'camera.person': 'personne',
    'camera.srTracking': 'La caméra suit un intrus détecté',
    'camera.srPatrol': 'La caméra patrouille',

    'error.request': 'Échec de la requête ({status})',
    'error.slowDown': 'Trop de requêtes. Patientez un instant puis réessayez.',
  },
}

/** t('note.sent', { node: 'North gate' }) — falls back to English, then to the key. */
export function t(key, vars) {
  const s = STRINGS[lang][key] ?? STRINGS.en[key] ?? key
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m)) : s
}

// ---- event messages ------------------------------------------------------------------------------
// The API stores messages in English. In French they are rebuilt from the event's kind and data
// (or parsed from the English text when the data doesn't carry the value); anything unknown stays English.

const REJECT_FR = {
  bad_signature: 'message falsifié (signature HMAC invalide)',
  identity_mismatch: 'un capteur a tenté de parler au nom d\'un autre',
  replay: 'message rejoué (séquence déjà vue)',
  unknown_node: 'message d\'un capteur inconnu',
  stale: 'message périmé (décalage d\'horloge > 30 s)',
  schema: 'schéma de message invalide',
  malformed: 'charge utile mal formée',
  unsigned: 'charge utile non signée',
  oversized: 'charge utile trop volumineuse',
}
const BROKER_FR = {
  tls_rejected: 'poignée de main TLS refusée (aucun certificat client valide)',
  not_authorized: 'client non autorisé',
  session_takeover: 'seconde connexion avec la même identité de capteur (certificat volé ?)',
  acl_denied: 'ACL : publication refusée (le capteur a tenté d\'écrire hors de ses topics)',
  protocol_error: 'erreur de protocole MQTT (tentative de fuzzing / d\'injection ?)',
}
const SIGNAL_FR = {
  pir: 'un mouvement', camera_person: 'une personne sur la caméra', sensor_anomaly: 'des relevés de capteurs anormaux',
  cyber: 'une attaque réseau', decoy: 'un leurre déclenché',
}
const score = (v) => (typeof v === 'number' ? v.toFixed(2) : '?')
const listFr = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} et ${xs[xs.length - 1]}` : xs[0] ?? '')

function frEvent(e) {
  const d = e.data || {}
  const n = d.node ?? e.source
  const msg = e.message || ''
  const grab = (rx) => msg.match(rx)?.[1]
  switch (e.kind) {
    case 'node_online': return `${n} est en ligne`
    case 'node_offline': return `${n} est hors ligne`
    case 'node_silent': return `${n} a cessé d'émettre`
    case 'boot': return `${n} a démarré`
    case 'pir': return `mouvement détecté par ${n}`
    case 'tamper': return `sabotage détecté sur ${n}`
    case 'cmd_forged': return `${n} a rejeté une commande falsifiée`
    case 'sensor_anomaly': return `dynamique anormale des capteurs sur ${n} (score ${score(d.score)})`
    case 'traffic_anomaly': return `trafic MQTT anormal depuis ${n} (score ${score(d.score)})`
    case 'person_in_zone':
      if (e.source === 'vision') return `${d.count ?? '?'} personne(s) dans la zone réglementée (caméra)`
      return `personne vue par la caméra près de ${n}` + (d.confidence ? ` (${d.confidence.toFixed(2)})` : '')
    case 'incident': {
      const what = listFr((d.signals || []).map((s) => SIGNAL_FR[s] ?? s))
      return `${e.severity === 'critical' ? 'Critique' : 'Alerte'} : ${what} à ${n}`
    }
    case 'auto_response':
      return `réponse automatique à ${n} : ` + (d.level === 'critical' ? 'voyant rouge et sirène' : 'voyant rouge')
    case 'schema':
      if (msg.startsWith('invalid telemetry')) return `champs de télémétrie invalides sur ${n}`
      return `${REJECT_FR.schema} sur ${n}`
    case 'rate_limited': {
      const name = grab(/rate limit hit on (\S+)/)
      return name ? `limite de débit atteinte sur ${name} depuis ${d.ip ?? '?'}` : null
    }
    case 'login_failed': {
      const user = grab(/failed login for '(.*)'$/)
      return user != null ? `échec de connexion pour « ${user} »` : null
    }
    case 'decoy_mqtt_login': {
      const user = d.username ?? grab(/ as '(.*)'$/) ?? ''
      return `tentative de connexion au broker leurre depuis ${d.ip} en tant que « ${user} »`
    }
    case 'decoy_mqtt_activity': {
      const m = msg.match(/: (publish|subscribe) (.*)$/)
      return m ? `attaquant sur le broker leurre : ${m[1] === 'publish' ? 'publication' : 'abonnement'} ${m[2]}` : null
    }
    case 'decoy_probe': {
      const port = grab(/decoy :(\d+)/)
      return `sonde non MQTT sur le leurre${port ? ` :${port}` : ''} depuis ${d.ip}`
    }
    case 'decoy_console_connect': return `connexion à la console leurre depuis ${d.ip}`
    case 'decoy_credentials': return `identifiants essayés sur la console leurre : « ${d.username ?? ''} »`
    default:
      if (REJECT_FR[e.kind]) return `${REJECT_FR[e.kind]} sur ${n}`
      if (BROKER_FR[e.kind]) {
        const who = grab(/ \[(\S+)\]$/)
        return BROKER_FR[e.kind] + (who ? ` [${who}]` : '')
      }
      return null
  }
}

export function eventMessage(e) {
  if (lang === 'en') return e.message
  try { return frEvent(e) ?? e.message } catch { return e.message }
}

// API error texts shown to the operator
export function apiError(message) {
  if (message === 'slow down') return t('error.slowDown')
  return message
}
