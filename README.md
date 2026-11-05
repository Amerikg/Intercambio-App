# Intercambio familiar navideño

Aplicación web responsiva para confirmar asistencia, compartir gustos y listas de regalos y realizar un sorteo familiar entre dispositivos. Supabase guarda los datos y aplica los permisos: cada integrante ve únicamente su asignación; administración puede consultar todos los resultados.

## Funcionalidad

- Inicio con acceso al sorteo, tablero de regalos y reglas familiares.
- Acceso con código de verificación enviado al correo. Cada cuenta se vincula a un solo integrante.
- Confirmación de asistencia y de que la lista está completa, con fecha límite del **23 de noviembre de 2026 a las 23:59, hora de Ciudad de México**.
- Botón **No estoy / pedir vinculación** para solicitar que el administrador agregue o vincule a un integrante.
- Tablero compartido de gustos e ideas de regalo.
- Sorteo único, autorizado por administración, sin autoasignaciones ni parejas de la misma subfamilia.
- Administración de la lista, solicitudes, confirmaciones, quién ya consultó su resultado y resultados completos.

La lista inicial se carga desde la migración de Supabase a partir de `Integrantes.txt`. Cada encabezado Familia 1–6 se considera una subfamilia.

## Configuración

Supabase es el backend (base de datos, autenticación y función de correo). Vercel publicará los archivos estáticos del sitio.

1. Crea un proyecto en Supabase.
2. En **SQL Editor**, ejecuta en orden `supabase/migrations/20261105000000_intercambio.sql` y después `supabase/migrations/20261105120000_privacidad_y_asistencia.sql` (login por nombre, asistencia Sí/No y subfamilia visible solo para administración; la lista de nombres para entrar es pública, sin familias).
3. En **Project Settings → API**, copia la URL del proyecto y la clave pública `anon`/publishable en `supabase-config.js`. Esos valores son visibles desde el navegador; nunca pongas una clave `service_role` en ese archivo.
4. En **Authentication**, configura el proveedor de correo/SMTP para entregar los códigos de acceso a todos los familiares. En **Authentication → Emails → Magic link**, el cuerpo de la plantilla debe incluir `{{ .Token }}` (por ejemplo: `Tu código es: {{ .Token }}`); de lo contrario el correo solo traerá un enlace. Agrega la URL final del sitio a las URLs permitidas de redirección.
5. Para probarlo localmente, inicia `py -m http.server 8000` y abre `http://localhost:8000`.
6. Inicia sesión con el correo del administrador. En SQL Editor, concede el rol administrativo a ese usuario, sustituyendo el marcador por su correo:

   ```sql
   insert into public.admin_users (user_id)
   select id from auth.users where lower(email) = lower('CORREO_ADMIN')
   on conflict do nothing;
   ```

   Si el administrador también participará, vincula su cuenta a su fila de participante:

   ```sql
   update public.participants
   set user_id = (select id from auth.users where lower(email) = lower('CORREO_ADMIN'))
   where lower(name) = lower('NOMBRE_PARTICIPANTE')
     and lower(subfamily) = lower('FAMILIA 1');
   ```

7. Configura el correo de aviso para **No estoy**. La función usa Resend y requiere un dominio remitente verificado. Con Supabase CLI vinculado al proyecto:

   ```text
   supabase secrets set ADMIN_EMAIL="correo-del-administrador" RESEND_API_KEY="clave-de-resend" RESEND_FROM_EMAIL="intercambio@tu-dominio-verificado"
   supabase functions deploy missing-member
   ```

   No guardes esas credenciales en el repositorio ni las compartas en el chat. La clave `service_role` solo se utiliza en el entorno seguro de funciones de Supabase.

8. Despliega en Vercel:
   - Importa el repositorio en Vercel.
   - Selecciona **Other** como framework preset y deja la raíz del proyecto como raíz del sitio. No requiere comando de build ni directorio de salida adicional.
   - Confirma que `supabase-config.js` tenga la URL del proyecto y la clave pública `anon`/publishable de Supabase antes de desplegar.
   - Después del primer despliegue, agrega el dominio de Vercel (incluida la URL de producción) a las URLs permitidas de redirección de Supabase Authentication.

   Cada familiar inicia sesión con su propio correo. Si ya está en la lista, puede enviar la solicitud para que administración vincule su cuenta; si falta, administración primero lo agrega con su subfamilia y después vincula la solicitud.

## Flujo del sorteo

Al entrar, cada persona elige «¿Quién eres?» y verifica su correo con un código; si no está en la lista, se avisa a administración. En Inicio, cada integrante responde ✓/✗ a «¿Asistirás?» y ve la respuesta de los demás. El sorteo permanece bloqueado hasta que todas las personas activas confirmen y administración lo autorice. Después de la fecha límite, administración debe cerrar las confirmaciones; las personas que no confirmaron quedan excluidas. La asignación se genera una sola vez y queda guardada en Supabase.

Una cuenta solo puede vincularse a una persona, y una persona a una cuenta. Esto evita que se elija otro nombre al volver a entrar desde otro dispositivo. No impide que alguien comparta su cuenta o use varias direcciones de correo.

## Privacidad y seguridad

- Las políticas RLS de la migración protegen asignaciones y solicitudes.
- Solo integrantes vinculados y administración pueden leer la lista, la configuración y el tablero.
- Cada participante solo puede leer su propia asignación; administración puede leerlas todas.
- Los gustos y las listas de regalos son visibles para integrantes autenticados.
- No publiques claves `service_role`, claves de Resend ni credenciales SMTP en JavaScript del navegador.
