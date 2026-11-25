import type { PartialTranslation } from "../../message";
import type { messages as source } from "../en/connector";

export const messages = {
  "connector.github.title": "GitHub",
  "connector.github.description":
    "Todos los agentes de este equipo pueden usar tus repositorios, incidencias y solicitudes de incorporación de GitHub, además de gh y git.",
  "connector.github.connect": "Conectar GitHub",
  "connector.github.pendingTitle": "Escribe este código en GitHub",
  "connector.github.pendingDescription": "GitHub se abrió en tu navegador. Escribe allí el código para conectarte.",
  "connector.github.waiting": "Esperando a GitHub",
  "connector.github.copyCode": "Copiar código",
  "connector.github.codeCopied": "Copiado",
  "connector.github.openGitHub": "Abrir GitHub",
  "connector.github.cancel": "Cancelar",
  "connector.github.connectedAs": "Conectado como @{login}",
  "connector.github.repositoriesTitle": "Repositorios",
  "connector.github.repositoriesDescription":
    "Los agentes solo pueden usar los repositorios donde está instalada la aplicación de GitHub de OpenBot.",
  "connector.github.chooseRepositories": "Elegir repositorios",
  "connector.github.repositoriesLoading": "Leyendo los repositorios de GitHub",
  "connector.github.noRepositories": "La aplicación de GitHub de OpenBot aún no está instalada en ningún repositorio.",
  "connector.github.moreRepositories": {
    one: "Y {count} repositorio más",
    other: "Y {count} repositorios más",
  },
  "connector.github.private": "Privado",
  "connector.github.disconnect": "Desconectar",
  "connector.github.disconnectTitle": "Desconectar GitHub",
  "connector.github.disconnectSummary":
    "Todos los agentes pierden el acceso a GitHub. Tus chats y archivos se conservan.",
  "connector.github.expiredTitle": "La conexión de GitHub caducó",
  "connector.github.expiredDescription":
    "Vuelve a conectarte como @{login} para devolver a los agentes el acceso a GitHub.",
  "connector.github.reconnect": "Reconectar",
  "connector.github.actionFailed": "OpenBot no pudo cambiar la conexión de GitHub.",
  "connector.github.statusConnected": "Conectado",
  "connector.github.statusConnecting": "Conectando",
  "connector.github.statusExpired": "Caducado",
  "connector.github.accountTitle": "Cuenta",
  "connector.github.filterPlaceholder": {
    one: "Filtrar {count} repositorio",
    other: "Filtrar {count} repositorios",
  },
  "connector.github.filterLabel": "Filtrar repositorios",
  "connector.github.noMatch": "Ningún repositorio coincide con «{query}».",
  "connector.github.stepSignIn": "Iniciar sesión",
  "connector.github.stepConnected": "Conectado",
  "connector.github.requestingCode": "OpenBot solicita un código a GitHub.",
  "connector.github.codeLabel": "Código {code}",
  "connector.github.failedTitle": "GitHub no se conectó",
  "connector.github.cancelConnecting": "Cancelar la conexión a GitHub",
  "connector.github.connectedSummary": {
    one: "{count} repositorio · todos los agentes de este equipo",
    other: "{count} repositorios · todos los agentes de este equipo",
  },
  "connector.github.done": "Listo",
  "connector.github.later": "Más tarde",
  "connector.github.disconnectConfirmTitle": "¿Desconectar GitHub?",
  "connector.github.disconnectConfirmDescription":
    "Al desconectar, se elimina de este equipo el inicio de sesión de @{login}.",
  "connector.github.disconnectEffectTools": "Todos los agentes pierden las herramientas de GitHub, gh y git.",
  "connector.github.disconnectEffectRevoke": "Después se abre GitHub, donde puedes revocar el acceso de OpenBot.",
  "connector.github.disconnectEffectKept":
    "Los chats, los archivos y la memoria de los agentes se conservan en este equipo.",
  "connector.github.descriptionHost":
    "Todos los agentes de {host} pueden usar tus repositorios, incidencias y solicitudes de incorporación de GitHub, además de gh y git.",
  "connector.github.connectedSummaryHost": {
    one: "{count} repositorio · todos los agentes de {host}",
    other: "{count} repositorios · todos los agentes de {host}",
  },
  "connector.github.disconnectConfirmDescriptionHost":
    "Al desconectar, se elimina de {host} el inicio de sesión de @{login}.",
  "connector.github.disconnectEffectKeptHost":
    "Los chats, los archivos y la memoria de los agentes se conservan en {host}.",
  "connector.github.keepConnected": "Mantener la conexión",
  "connector.github.close": "Cerrar",
  "connector.dangerZone": "Zona de peligro",
  "connector.statusUnknown": "Desconocido",
  "connector.readFailed": "OpenBot no pudo leer el estado de esta conexión.",
  "connector.whatsapp.title": "WhatsApp",
  "connector.whatsapp.description":
    "Vincula un número de WhatsApp a este equipo. El Orquestador de WhatsApp consulta al agente adecuado y responde.",
  "connector.whatsapp.descriptionHost":
    "Vincula un número de WhatsApp a este servidor. El Orquestador de WhatsApp consulta al agente adecuado y responde.",
  "connector.whatsapp.statusConnected": "Conectado",
  "connector.whatsapp.statusAttention": "Requiere atención",
  "connector.whatsapp.summaryConnected": {
    one: "{count} número · Responde el Orquestador de WhatsApp",
    other: "{count} números · Responde el Orquestador de WhatsApp",
  },
  "connector.whatsapp.summaryNoAgent": {
    one: "{count} número · Aún no responde ningún agente",
    other: "{count} números · Aún no responde ningún agente",
  },
  "connector.whatsapp.attentionTitle": {
    one: "{count} número requiere atención",
    other: "{count} números requieren atención",
  },
  "connector.whatsapp.attentionDescription": "El estado que aparece abajo indica qué hacer.",
  "connector.whatsapp.connect": "Vincular WhatsApp",
  "connector.whatsapp.addAgent": "Añadir agente",
  "connector.whatsapp.actionFailed": "WhatsApp no aceptó el cambio",
  "connector.whatsapp.numbersTitle": "Números",
  "connector.whatsapp.linkNumber": "Vincular un número",
  "connector.whatsapp.ownNumberNote":
    "Tu chat «Envíate un mensaje» y las personas que permitas pueden contactar con OpenBot.",
  "connector.whatsapp.dedicatedNote":
    "Tu chat «Envíate un mensaje» y las personas que permitas pueden contactar con OpenBot. Las demás reciben un código para dártelo.",
  "connector.whatsapp.helpLoggedOut":
    "WhatsApp quitó este equipo de los dispositivos vinculados. Vuelve a vincular el número.",
  "connector.whatsapp.helpLoggedOutHost":
    "WhatsApp quitó este servidor de los dispositivos vinculados. Vuelve a vincular el número.",
  "connector.whatsapp.helpError":
    "OpenBot no puede acceder a WhatsApp en este número. Vuelve a conectar o desconecta el número.",
  "connector.whatsapp.helpKeysUnreadable":
    "OpenBot no puede leer las claves guardadas de este número. Vuelve a vincular el número.",
  "connector.whatsapp.retryAt": "WhatsApp pidió a OpenBot que esperara. Lo intentará de nuevo a las {time}.",
  "connector.whatsapp.pause": "Pausar",
  "connector.whatsapp.resume": "Reanudar",
  "connector.whatsapp.reconnect": "Reconectar",
  "connector.whatsapp.linkAgain": "Volver a vincular",
  "connector.whatsapp.disconnect": "Desconectar",
  "connector.whatsapp.disconnectAllTitle": "Desconectar WhatsApp",
  "connector.whatsapp.disconnectAllSummary":
    "Se desconectan todos los números. Nadie podrá contactar con tus agentes a través de WhatsApp.",
  "connector.whatsapp.disconnectAllSummaryOrchestrator":
    "Se desconectan todos los números. El Orquestador de WhatsApp y sus conversaciones se eliminan de OpenBot.",
  "connector.whatsapp.rowAction": "{action}: {name}",
  "connector.whatsapp.ownNumber": "Número personal",
  "connector.whatsapp.ownNumberDescription":
    "Solo pueden escribir tu chat «Envíate un mensaje» y las personas que permitas. Las demás no reciben respuesta. Si está desactivado, OpenBot responde a las personas desconocidas con un código.",
  "connector.whatsapp.workingMessage": "Mensaje «Trabajando en ello…»",
  "connector.whatsapp.workingMessageDescription":
    "OpenBot lo envía mientras el agente trabaja y luego lo sustituye por la respuesta. Una solicitud que espera a otra anterior también recibe un mensaje de espera. Con un número personal, solo tu chat «Envíate un mensaje» recibe estos mensajes. Desactívalo para enviar solo la respuesta.",
  "connector.whatsapp.statusReactions": "Reacciones de estado",
  "connector.whatsapp.statusReactionsDescription":
    "OpenBot reacciona con 👀 cuando llega un mensaje y con ✅ cuando la respuesta está lista. Desactívalas para no enviar reacciones.",
  "connector.whatsapp.orchestratorTitle": "Orquestador de WhatsApp",
  "connector.whatsapp.orchestratorDescription":
    "Este agente recibe los mensajes para OpenBot de todos tus números vinculados. Responde él mismo a los cortos, asigna el resto del trabajo al agente adecuado y responde en WhatsApp.",
  "connector.whatsapp.orchestratorNone": "Aún no responde ningún agente",
  "connector.whatsapp.orchestratorNoneDescription":
    "Añade el Orquestador de WhatsApp o WhatsApp no recibirá respuesta.",
  "connector.whatsapp.note":
    "En tu número personal, escribe en tu chat «Envíate un mensaje». Las personas que permitas escriben al número.",
  "connector.whatsapp.stepNumber": "Número",
  "connector.whatsapp.stepAgent": "Agente",
  "connector.whatsapp.connectTitle": "Vincular WhatsApp",
  "connector.whatsapp.connectDescription":
    "Selecciona el número y luego vincula este equipo desde WhatsApp en tu teléfono.",
  "connector.whatsapp.connectDescriptionHost":
    "Selecciona el número y luego vincula este servidor desde WhatsApp en tu teléfono.",
  "connector.whatsapp.kindLabel": "Número",
  "connector.whatsapp.kindPersonal": "Mi número personal",
  "connector.whatsapp.kindPersonalDescription":
    "OpenBot solo responde a tu chat «Envíate un mensaje» y a las personas que permitas. Las demás personas no reciben respuesta.",
  "connector.whatsapp.kindDedicated": "Un número solo para OpenBot",
  "connector.whatsapp.kindDedicatedDescription":
    "OpenBot responde desde este número a cada persona desconocida con un código para dártelo. Tú las apruebas aquí.",
  "connector.whatsapp.methodLabel": "Cómo vincular",
  "connector.whatsapp.methodQr": "Código QR",
  "connector.whatsapp.methodCode": "Código de vinculación",
  "connector.whatsapp.phoneLabel": "Número de teléfono",
  "connector.whatsapp.phoneDescription": "Con el código de país, por ejemplo +44 7700 900123.",
  "connector.whatsapp.phoneInvalid": "Escribe el número de teléfono con su código de país.",
  "connector.whatsapp.showQr": "Mostrar código QR",
  "connector.whatsapp.getCode": "Obtener código",
  "connector.whatsapp.starting": "Pidiendo un código a WhatsApp…",
  "connector.whatsapp.connectStepOpen": "Abre WhatsApp en tu teléfono",
  "connector.whatsapp.connectStepDevices":
    "Toca Ajustes, luego Dispositivos vinculados y luego Vincular un dispositivo",
  "connector.whatsapp.connectStepScan": "Apunta el teléfono a este código",
  "connector.whatsapp.connectWaiting": "Esperando al teléfono. El código cambia cada 20 segundos aproximadamente.",
  "connector.whatsapp.qrLabel": "Código QR para vincular WhatsApp",
  "connector.whatsapp.codeStepDevices": "En WhatsApp, abre Dispositivos vinculados y toca Vincular un dispositivo",
  "connector.whatsapp.codeStepPhone": "Toca Vincular con el número de teléfono",
  "connector.whatsapp.codeStepType": "Escribe este código en el teléfono",
  "connector.whatsapp.codeLabel": "Código de vinculación {code}",
  "connector.whatsapp.copyCode": "Copiar código",
  "connector.whatsapp.codeWaiting": "Esperando al teléfono.",
  "connector.whatsapp.failedTitle": "WhatsApp no se vinculó",
  "connector.whatsapp.failedTimeout": "El código caducó antes de que el teléfono lo usara.",
  "connector.whatsapp.failedRefused": "WhatsApp rechazó la vinculación. Espera unos minutos y vuelve a intentarlo.",
  "connector.whatsapp.failedBusy": "Hay otra vinculación en curso. Espera a que termine y vuelve a intentarlo.",
  "connector.whatsapp.failedUnavailable": "OpenBot no puede acceder a WhatsApp. Comprueba la conexión a internet.",
  "connector.whatsapp.tryAgain": "Reintentar",
  "connector.whatsapp.agentStepTitle": "Añadir el Orquestador de WhatsApp",
  "connector.whatsapp.agentStepDescription":
    "Este nuevo agente responde a los mensajes para OpenBot en {number} y en cada número que vincules más adelante.",
  "connector.whatsapp.orchestratorName": "Orquestador de WhatsApp",
  "connector.whatsapp.orchestratorRole": "Responde en WhatsApp y consulta al equipo",
  "connector.whatsapp.orchestratorDoesReceive": "Recibe primero cada mensaje de WhatsApp para OpenBot",
  "connector.whatsapp.orchestratorDoesDelegate": "Asigna cada tarea al agente más adecuado",
  "connector.whatsapp.orchestratorDoesAnswer": "Responde en el chat de WhatsApp",
  "connector.whatsapp.orchestratorModel": "Modelo",
  "connector.whatsapp.doneTitle": "OpenBot está vinculado a {number}",
  "connector.whatsapp.done": "Listo",
  "connector.whatsapp.disconnectTitle": "¿Desconectar {number}?",
  "connector.whatsapp.disconnectDescription":
    "OpenBot cierra la sesión de WhatsApp en {number}. Si OpenBot estaba apagado, quita también el dispositivo en WhatsApp > Dispositivos vinculados.",
  "connector.whatsapp.disconnectEffect": "Nadie podrá contactar con tus agentes a través de {number}.",
  "connector.whatsapp.removeEffectKept": "Las conversaciones y el Orquestador de WhatsApp permanecen en OpenBot.",
  "connector.whatsapp.removeEffectDeleted":
    "Es el último número, así que el Orquestador de WhatsApp y sus conversaciones se eliminan de OpenBot.",
  "connector.whatsapp.keep": "Mantener vinculado",
  "connector.whatsapp.close": "Cerrar",
  "connector.whatsapp.sendersTitle": "Quién puede escribir a {number}",
  "connector.whatsapp.sendersDescription": "Estos contactos y grupos pueden asignar trabajo a tus agentes.",
  "connector.whatsapp.sendersEmpty": "Solo tú puedes escribir. Añade un contacto o un grupo.",
  "connector.whatsapp.sendersLimit": "Un número puede permitir hasta {count} contactos y grupos.",
  "connector.whatsapp.senderGroup": "Grupo",
  "connector.whatsapp.removeSender": "Quitar",
  "connector.whatsapp.senderAccess": "Acceso de {name}",
  "connector.whatsapp.senderReplies": "Puede dar tareas",
  "connector.whatsapp.senderReadOnly": "Solo lectura",
  "connector.whatsapp.addContact": "Añadir contacto",
  "connector.whatsapp.addGroup": "Añadir grupo",
  "connector.whatsapp.contactTitle": "Añadir un contacto",
  "connector.whatsapp.contactDescription": "Esta persona puede asignar trabajo a tus agentes desde WhatsApp.",
  "connector.whatsapp.contactName": "Nombre",
  "connector.whatsapp.contactNameDescription": "Opcional. Si lo dejas vacío, la lista muestra el número de teléfono.",
  "connector.whatsapp.add": "Añadir",
  "connector.whatsapp.groupTitle": "Añadir un grupo",
  "connector.whatsapp.groupDescription":
    "Las personas de este grupo pueden asignar trabajo a tus agentes cuando mencionan el número o responden a sus mensajes.",
  "connector.whatsapp.groupSearch": "Buscar grupos",
  "connector.whatsapp.groupsLoading": "Leyendo los grupos…",
  "connector.whatsapp.groupsLoadFailed": "OpenBot no pudo leer los grupos",
  "connector.whatsapp.groupsEmpty": "Este número no está en ningún grupo.",
  "connector.whatsapp.groupsNoMatch": "Ningún grupo tiene este nombre.",
  "connector.whatsapp.groupAdded": "Añadido",
  "connector.whatsapp.requestsTitle": "Solicitudes para {number}",
  "connector.whatsapp.requestsDescription":
    "Estas personas escribieron al número y recibieron un código. Aprueba a una persona solo si te dio el mismo código.",
  "connector.whatsapp.requestsEmpty": "No hay solicitudes.",
  "connector.whatsapp.requestDetail": "Código {code} · {number}",
  "connector.whatsapp.approve": "Aprobar",
  "connector.whatsapp.deny": "Rechazar",
  "connector.onePassword.title": "1Password",
  "connector.onePassword.description":
    "Comparte con OpenBot una bóveda exclusiva de 1Password mediante una cuenta de servicio para que los agentes puedan iniciar sesión en sitios desde el navegador de OpenBot.",
  "connector.onePassword.howItWorks":
    "Al conectar, se crea una bóveda «Shared with OpenBot» en tu cuenta de 1Password y una cuenta de servicio que solo puede leer esa bóveda. OpenBot rellena los inicios de sesión guardados en su navegador en este equipo, por lo que solo se comparten los elementos que muevas a esa bóveda. Los agentes nunca ven contraseñas.",
  "connector.onePassword.connect": "Conectar 1Password",
  "connector.onePassword.setupTitle": "Configurar",
  "connector.onePassword.stepCliTitle": "Instalar la CLI de 1Password",
  "connector.onePassword.stepCliChecking": "Buscando la CLI de 1Password en este equipo",
  "connector.onePassword.stepCliInstalling": "Descargando la CLI de 1Password desde 1Password",
  "connector.onePassword.stepCliReady": "La versión {version} está instalada.",
  "connector.onePassword.stepCliMissing":
    "OpenBot la descarga desde 1Password a su propia carpeta. No necesita contraseña de administrador.",
  "connector.onePassword.stepCliManual":
    "OpenBot no puede instalarla en este equipo. Instálala desde 1Password y vuelve a esta página.",
  "connector.onePassword.installCli": "Instalar",
  "connector.onePassword.stepAppTitle": "Activar la integración con la CLI",
  "connector.onePassword.stepAppDescription":
    "En la aplicación de 1Password, abre Ajustes > Desarrollador y activa «Integrar con la CLI de 1Password».",
  "connector.onePassword.stepAppReady": "La aplicación de 1Password permite que la CLI cree la bóveda compartida.",
  "connector.onePassword.openApp": "Abrir 1Password",
  "connector.onePassword.openAppFailed": "OpenBot no pudo abrir 1Password.",
  "connector.onePassword.checkAgain": "Comprobar",
  "connector.onePassword.stepVaultTitle": "Crear la bóveda compartida",
  "connector.onePassword.stepVaultDescription":
    "OpenBot crea la bóveda «Shared with OpenBot» y una cuenta de servicio que solo puede leerla. 1Password te pide que lo apruebes.",
  "connector.onePassword.useTokenDescription":
    "En lugar de estos pasos, pega un token de cuenta de servicio de 1Password.com.",
  "connector.onePassword.useTokenAction": "Usar token",
  "connector.onePassword.tokenLabel": "Token de cuenta de servicio",
  "connector.onePassword.tokenPlaceholder": "ops_…",
  "connector.onePassword.connectWithToken": "Conectar",
  "connector.onePassword.approveInApp": "Aprueba la solicitud en la aplicación de 1Password",
  "connector.onePassword.cancel": "Cancelar",
  "connector.onePassword.chooseAccountTitle": "Elegir una cuenta",
  "connector.onePassword.chooseAccountDescription": "OpenBot crea la bóveda compartida en la cuenta que elijas.",
  "connector.onePassword.useAccount": "Usar esta cuenta",
  "connector.onePassword.vaultTitle": "Bóveda compartida",
  "connector.onePassword.vaultDescription":
    "Mueve un inicio de sesión a esta bóveda en 1Password para que los agentes puedan usarlo. Retíralo para impedir su uso.",
  "connector.onePassword.loginsLoading": "Leyendo los inicios de sesión de 1Password",
  "connector.onePassword.loginCount": {
    one: "{count} inicio de sesión",
    other: "{count} inicios de sesión",
  },
  "connector.onePassword.disconnect": "Desconectar",
  "connector.onePassword.disconnectTitle": "Desconectar 1Password",
  "connector.onePassword.disconnectSummary":
    "OpenBot olvida el token. La bóveda y la cuenta de servicio permanecen en 1Password; elimínalas allí si ya no las necesitas.",
  "connector.onePassword.actionFailed": "OpenBot no pudo cambiar la conexión de 1Password.",
  "connector.onePassword.statusConnected": "Conectado",
  "connector.onePassword.statusConnecting": "Conectando",
  "connector.onePassword.descriptionHost":
    "Comparte con OpenBot en {host} una bóveda exclusiva de 1Password mediante una cuenta de servicio, para que los agentes de {host} puedan iniciar sesión en sitios desde su navegador.",
  "connector.onePassword.howItWorksHost":
    "{host} se conecta con un token de cuenta de servicio. En 1Password.com, crea una cuenta de servicio que solo pueda leer la bóveda que compartes con OpenBot y pega aquí su token. {host} comprueba el token y lo guarda; este equipo no. Los agentes nunca ven una contraseña.",
  "connector.onePassword.disconnectSummaryHost":
    "{host} olvida el token. La bóveda y la cuenta de servicio permanecen en 1Password; elimínalas allí si ya no las necesitas.",
  "connector.bitwarden.title": "Bitwarden",
  "connector.bitwarden.description": "Rellena los inicios de sesión del navegador desde Bitwarden.",
  "connector.bitwarden.setup":
    "Instala la CLI de Bitwarden e inicia sesión con bw login. Crea una carpeta llamada Shared with OpenBot y guarda en ella solo los inicios de sesión que puedan usar los agentes. Ejecuta bw unlock --raw y pega la clave de sesión abajo. No pegues tu contraseña maestra.",
  "connector.bitwarden.scope":
    "Todos los agentes de este equipo pueden usar los inicios de sesión coincidentes de Shared with OpenBot. OpenBot usa orígenes HTTPS exactos. No usa elementos que requieran solicitar la contraseña maestra ni una regla personalizada de coincidencia de URI.",
  "connector.bitwarden.session":
    "La clave de sesión permanece en memoria. Vuelve a conectarte tras 8 horas sin usar la bóveda o después de cerrar OpenBot. Desconectar detiene el acceso de OpenBot; no bloquea otros clientes de Bitwarden.",
  "connector.bitwarden.sessionKey": "Clave de sesión de Bitwarden",
  "connector.bitwarden.connect": "Conectar Bitwarden",
  "connector.bitwarden.disconnect": "Desconectar Bitwarden",
  "connector.bitwarden.disconnectAction": "Desconectar",
  "connector.bitwarden.disconnectSummary":
    "OpenBot olvida la clave de sesión. Los agentes ya no pueden rellenar inicios de sesión desde Bitwarden. Los demás clientes de Bitwarden siguen desbloqueados.",
  "connector.bitwarden.disconnectSummaryHost":
    "{host} elimina la clave de API y la contraseña maestra. Los agentes de {host} ya no pueden rellenar inicios de sesión desde Bitwarden.",
  "connector.bitwarden.connected": "Conectado",
  "connector.bitwarden.actionFailed": "OpenBot no pudo cambiar la conexión de Bitwarden.",
  "connector.bitwarden.descriptionHost":
    "Rellena los inicios de sesión del navegador en {host} desde Bitwarden o Vaultwarden.",
  "connector.bitwarden.setupHost":
    "{host} inicia sesión con su propia CLI de Bitwarden. En tu caja fuerte, crea una carpeta llamada Shared with OpenBot y pon en ella solo los inicios de sesión que los agentes pueden usar. En la caja fuerte web, abre Configuración › Seguridad › Claves y muestra tu clave de API. Introduce abajo la dirección del servidor, client_id, client_secret y tu contraseña maestra.",
  "connector.bitwarden.scopeHost":
    "Todos los agentes de {host} pueden usar los inicios de sesión coincidentes de Shared with OpenBot. OpenBot usa orígenes HTTPS exactos. No usa elementos que piden la contraseña maestra ni los que tienen una regla de coincidencia de URI personalizada.",
  "connector.bitwarden.sessionHost":
    "{host} guarda la clave de API y la contraseña maestra cifradas, para poder desbloquear de nuevo después de reiniciarse. Este ordenador no las guarda. Desconectar las elimina de {host}. {host} debe llegar a la dirección del servidor por HTTPS.",
  "connector.bitwarden.serverUrl": "Dirección del servidor",
  "connector.bitwarden.folderTitle": "Carpeta compartida",
  "connector.bitwarden.folderDescription":
    "Mueve un inicio de sesión a esta carpeta en Bitwarden para que los agentes puedan usarlo. Retíralo para impedir su uso.",
  "connector.bitwarden.folderName": "Shared with OpenBot",
  "connector.bitwarden.folderKind": "Carpeta en Bitwarden",
  "connector.bitwarden.clientId": "client_id de la clave de API",
  "connector.bitwarden.clientSecret": "client_secret de la clave de API",
  "connector.bitwarden.masterPassword": "Contraseña maestra",
  "connector.bitwarden.connecting": "Conectando",
  "connector.protonPass.title": "Proton Pass",
  "connector.protonPass.description":
    "Permite que los agentes inicien sesión en sitios con las credenciales de una bóveda compartida de Proton Pass.",
  "connector.protonPass.descriptionHost":
    "Permite que los agentes de {host} inicien sesión en sitios con las credenciales de una bóveda compartida de Proton Pass.",
  "connector.protonPass.connect": "Conectar",
  "connector.protonPass.moreWays": "Más formas de conectar",
  "connector.protonPass.useKey": "Usar una clave de acceso",
  "connector.protonPass.keyLabel": "Clave de acceso",
  "connector.protonPass.keyPlaceholder": "pst_…",
  "connector.protonPass.setupTitle": "Configurar",
  "connector.protonPass.setupDescription":
    "Conectar abre el inicio de sesión de Proton en tu navegador. Después, OpenBot crea la bóveda compartida y solo guarda una clave de solo lectura para ella.",
  "connector.protonPass.setupDescriptionHost":
    "Conectar abre el inicio de sesión de Proton en tu navegador. Después, {host} crea la bóveda compartida y solo guarda una clave de solo lectura para ella.",
  "connector.protonPass.vaultName": "Shared with OpenBot",
  "connector.protonPass.vaultSetup":
    "OpenBot crea esta bóveda al conectar. Mueve credenciales a ella para compartirlas.",
  "connector.protonPass.showSteps": "Ver pasos",
  "connector.protonPass.stepsLabel": "Pasos de conexión",
  "connector.protonPass.stepSignIn": "Iniciar sesión",
  "connector.protonPass.stepVault": "Crear la bóveda compartida",
  "connector.protonPass.stepDone": "Listo",
  "connector.protonPass.signInTitle": "Inicia sesión en Proton",
  "connector.protonPass.signInStarting":
    "OpenBot inicia el inicio de sesión. La página de Proton se abre en tu navegador.",
  "connector.protonPass.signInDescription":
    "El inicio de sesión está abierto en tu navegador. Proton pide tu contraseña y tu segundo factor.",
  "connector.protonPass.signInDescriptionHost":
    "El inicio de sesión para {host} está abierto en tu navegador. Proton pide tu contraseña y tu segundo factor.",
  "connector.protonPass.extraPasswordDescription": "Proton Pass pide tu contraseña adicional.",
  "connector.protonPass.extraPasswordWrong": "La contraseña adicional no es correcta. Escríbela de nuevo.",
  "connector.protonPass.extraPasswordLabel": "Contraseña adicional",
  "connector.protonPass.continue": "Continuar",
  "connector.protonPass.setupStepTitle": "Creando la bóveda compartida",
  "connector.protonPass.setupStepDescription":
    "OpenBot crea la bóveda «{vault}» y una clave de solo lectura para ella. Después cierra tu sesión de Proton.",
  "connector.protonPass.doneTitle": "Proton Pass está conectado",
  "connector.protonPass.doneDescription":
    "Mueve credenciales a «{vault}» para que los agentes inicien sesión con ellas.",
  "connector.protonPass.failedTitle": "Proton Pass no se conectó",
  "connector.protonPass.copyLink": "Copiar enlace",
  "connector.protonPass.linkCopied": "Copiado",
  "connector.protonPass.openAgain": "Abrir de nuevo",
  "connector.protonPass.done": "Listo",
  "connector.protonPass.close": "Cerrar",
  "connector.protonPass.statusConnecting": "Conectando",
  "connector.protonPass.statusConnected": "Conectado",
  "connector.protonPass.statusExpired": "Clave caducada",
  "connector.protonPass.expiredTitle": "La clave de Proton Pass caducó",
  "connector.protonPass.expiredDescription":
    "Los agentes no pueden iniciar sesión con tus credenciales compartidas hasta que vuelvas a iniciar sesión.",
  "connector.protonPass.reconnect": "Reconectar",
  "connector.protonPass.planTitle": "Proton Pass necesita un plan con Pass Plus",
  "connector.protonPass.planDescription":
    "La CLI de Proton Pass necesita un plan de Proton que incluya Pass Plus. Otros planes de pago, como Mail Plus, no la incluyen. Cambia tu plan y vuelve a conectar.",
  "connector.protonPass.vaultTitle": "Bóveda compartida",
  "connector.protonPass.vaultDescription":
    "Los agentes pueden iniciar sesión con las credenciales de esta bóveda. Mueve una credencial a ella para compartirla.",
  "connector.protonPass.loginCount": { one: "{count} inicio de sesión", other: "{count} inicios de sesión" },
  "connector.protonPass.loginsLoading": "Contando credenciales…",
  "connector.protonPass.keyExpires": "Solo lectura. Caduca el {date}.",
  "connector.protonPass.keyExpired": "Solo lectura. Caducó el {date}.",
  "connector.protonPass.keyNoExpiry": "Solo lectura. No caduca.",
  "connector.protonPass.disconnectTitle": "Desconectar Proton Pass",
  "connector.protonPass.disconnectSummary":
    "OpenBot elimina su clave de acceso en este equipo. La bóveda y sus credenciales se quedan en tu cuenta de Proton.",
  "connector.protonPass.disconnectSummaryHost":
    "OpenBot elimina su clave de acceso en {host}. La bóveda y sus credenciales se quedan en tu cuenta de Proton.",
  "connector.protonPass.disconnect": "Desconectar",
  "connector.protonPass.actionFailed": "OpenBot no pudo cambiar la conexión de Proton Pass.",
} as const satisfies PartialTranslation<typeof source>;
