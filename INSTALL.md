# RenamerJF — Guía de instalación y administración (TI)

Guía para desplegar **RenamerJF** en equipos del bufete (VDIs Windows 11 y Macs).

---

## 1. Descargar el instalador

Los instaladores se generan en **GitHub Actions**:

- renamerjf: https://github.com/Juanesf14/renamerjf/actions
- ProyectoKPML: https://github.com/Juanesf14/ProyectoKPML/actions

Pasos:
1. Pestaña **Actions** → workflow **"Build Installers (Mac + Windows)"**.
2. Si no hay un build reciente: **Run workflow** → rama `main` → esperar ~2-3 min.
3. Abrir el run en verde (✓) → sección **Artifacts** → descargar:
   - `RenamerJF-Windows` → archivo `.exe` (para las VDIs)
   - `RenamerJF-Mac` → archivo `.dmg`
4. Los artifacts vienen en `.zip`; descomprimir antes de instalar.

> Los artifacts caducan a los 30 días y requieren cuenta de GitHub con acceso al repo.
> Para distribuir a varios equipos sin login, publicar un **Release** con los instaladores adjuntos.

---

## 2. Instalar en Windows 11 (VDIs)

1. Ejecutar el `.exe`.
2. Aparecerá **"Windows protegió tu PC"** (SmartScreen, porque la app no está firmada):
   → **Más información** → **Ejecutar de todas formas**.
3. Seguir el instalador (permite elegir carpeta; crea acceso directo en el escritorio).

> **Despliegue masivo:** para que los usuarios no vean SmartScreen, agregar el ejecutable
> a la lista de confianza por política de grupo (AppLocker / SmartScreen).
> La solución definitiva es firmar el código con un certificado de firma de Windows.

---

## 3. Instalar en macOS

La app no está firmada con un certificado de Apple, así que macOS la marca en cuarentena.

**Con Terminal (recomendado):**
```bash
# Quitar la cuarentena ANTES de abrir (ajustar el nombre del archivo)
xattr -d com.apple.quarantine ~/Downloads/RenamerJF-1.0.0-arm64.dmg
```
Luego: doble clic al `.dmg` → arrastrar la app a **Aplicaciones** → abrir **siempre desde Aplicaciones** (nunca desde la ventana del DMG).

**Sin Terminal:** arrastrar a Aplicaciones y la primera vez abrir con **clic derecho → Abrir → Abrir**.

> En Apple Silicon (M1/M2/M3) usar el DMG `-arm64`; en Intel, el DMG sin `-arm64`.

---

## 4. Primer arranque — crear el administrador inicial

Cada instalación arranca con su **propia base de datos vacía** (sin usuarios).

1. Al abrir la app por primera vez, la pantalla de login muestra **"First-time setup — create the administrator account for this computer"**.
2. Completar nombre, email y contraseña (**mínimo 8 caracteres**).
3. **Create administrator** → quedas dentro como admin.

A partir de ahí, el admin crea las demás cuentas desde el panel de usuarios (ver sección 6).

> El auto-registro público está deshabilitado: **solo un admin** crea cuentas nuevas.

---

## 5. ⚠️ Regla de los 2 administradores

**Crear siempre al menos DOS cuentas de administrador por equipo.**

Motivo: si el único admin olvida su contraseña, no hay recuperación por email (la app es
local, sin servidor de correo). Con un segundo admin, este puede resetear la contraseña del
primero. Sin un segundo admin, el equipo queda bloqueado y requiere intervención manual de TI
(ver sección 7).

---

## 6. Gestión de contraseñas

Todo se hace desde el modal **Account** (clic en el **nombre de usuario**, arriba a la derecha).

**Cambiar la propia contraseña** (cualquier usuario, sabiendo la actual):
- Account → pestaña **"My password"** → actual + nueva + confirmar → **Update password**.

**Resetear la contraseña de otro usuario** (solo admin — reemplaza el "recuperar por email"):
- Account → pestaña **"Users"** → ubicar al usuario → **Reset password** → escribir una
  contraseña temporal (mín. 8) → **Save**.
- Entregar la temporal al usuario; este entra y la cambia con "My password".

**Crear / eliminar usuarios** (solo admin):
- Account → **"Users"** → formulario "Add user" (rol User o Admin) / botón **Delete**.
- No se puede eliminar la propia cuenta ni al **último** administrador.

---

## 7. Recuperación ante bloqueo total (solo TI)

Si un equipo queda sin ningún admin con acceso, hay que resetear el hash directamente en la
base de datos SQLite de esa máquina:

- **Windows:** `%APPDATA%\RenamerJF\renamerjf.db`
- **macOS:** `~/Library/Application Support/RenamerJF/renamerjf.db`
  - (Para la variante con ML: carpeta `RenamerJF ML` en lugar de `RenamerJF`.)

El procedimiento (generar un hash bcrypt nuevo y actualizar la fila del usuario) lo realiza TI
con una herramienta de SQLite. Mantener este paso restringido a TI.

---

## 8. Nota sobre gestión centralizada

Hoy **los usuarios son por equipo** (cada instalación tiene su propia lista). No hay
administración central de logins. Para centralizar identidad (alta/baja única, recuperación
self-service, MFA) la ruta es integrar **Okta / Entra ID** vía OIDC — pendiente de confirmar
acceso a la consola de Okta del bufete.
