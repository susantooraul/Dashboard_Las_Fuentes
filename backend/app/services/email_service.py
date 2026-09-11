from __future__ import annotations

import logging
import smtplib
import socket
import ssl
from dataclasses import dataclass
from email.message import EmailMessage
from email.utils import formatdate, make_msgid
from pathlib import Path
from typing import Iterable

from app.config import get_settings


settings = get_settings()
logger = logging.getLogger(__name__)


class EmailServiceError(RuntimeError):
    """Base error for SMTP delivery failures."""


class EmailNotConfiguredError(EmailServiceError):
    """Raised when SMTP variables are missing."""


class EmailDeliveryError(EmailServiceError):
    """Raised when SMTP accepts configuration but delivery fails."""


@dataclass(frozen=True)
class EmailSendResult:
    message: str
    message_id: str


def _normalize_recipients(value: str | Iterable[str] | None) -> list[str]:
    if not value:
        return []
    if isinstance(value, str):
        parts = value.replace(';', ',').split(',')
    else:
        parts = []
        for item in value:
            parts.extend(str(item).replace(';', ',').split(','))
    return [part.strip() for part in parts if part and part.strip()]


def ensure_smtp_configured() -> None:
    missing = []
    if not settings.smtp_host:
        missing.append('SMTP_HOST')
    if not settings.smtp_port:
        missing.append('SMTP_PORT')
    if not settings.smtp_username:
        missing.append('SMTP_USERNAME')
    if not settings.smtp_password:
        missing.append('SMTP_PASSWORD')
    if not settings.smtp_from:
        missing.append('SMTP_FROM')
    if missing:
        raise EmailNotConfiguredError(
            'SMTP no configurado. Revisa las variables de correo del backend.'
        )


def _smtp_mode() -> tuple[bool, str]:
    use_implicit_ssl = settings.smtp_use_ssl or settings.smtp_port == 465
    mode = 'ssl' if use_implicit_ssl else ('starttls' if settings.smtp_use_starttls else 'plain')
    return use_implicit_ssl, mode


def _log_smtp_error(
    exc: BaseException,
    mode: str,
    message_id: str,
    recipients: list[str],
    subject: str,
) -> None:
    # No registrar credenciales, contenido del mensaje ni valores completos del .env.
    logger.error(
        'SMTP report email failed message_id=%s exception_type=%s sender=%s '
        'recipients=%s subject=%s host=%s port=%s mode=%s',
        message_id,
        type(exc).__name__,
        settings.smtp_from,
        recipients,
        subject,
        settings.smtp_host,
        settings.smtp_port,
        mode,
    )


def _send_message(email: EmailMessage, recipients: list[str]) -> str:
    ensure_smtp_configured()
    context = ssl.create_default_context()
    use_implicit_ssl, mode = _smtp_mode()
    message_id = str(email.get('Message-ID') or make_msgid(domain='rsrc.com.mx'))
    if not email.get('Message-ID'):
        email['Message-ID'] = message_id
    if not email.get('Date'):
        email['Date'] = formatdate(localtime=True)

    subject = str(email.get('Subject') or '')
    logger.info(
        'SMTP sending report email message_id=%s date=%s sender=%s recipients=%s '
        'subject=%s host=%s port=%s mode=%s',
        message_id,
        email.get('Date'),
        settings.smtp_from,
        recipients,
        subject,
        settings.smtp_host,
        settings.smtp_port,
        mode,
    )

    try:
        if use_implicit_ssl:
            with smtplib.SMTP_SSL(
                settings.smtp_host,
                settings.smtp_port,
                timeout=30,
                context=context,
            ) as server:
                server.login(settings.smtp_username, settings.smtp_password)
                refused_recipients = server.send_message(
                    email,
                    from_addr=settings.smtp_from,
                    to_addrs=recipients,
                )
        else:
            with smtplib.SMTP(
                settings.smtp_host,
                settings.smtp_port,
                timeout=30,
            ) as server:
                server.ehlo()
                if settings.smtp_use_starttls:
                    server.starttls(context=context)
                    server.ehlo()
                server.login(settings.smtp_username, settings.smtp_password)
                refused_recipients = server.send_message(
                    email,
                    from_addr=settings.smtp_from,
                    to_addrs=recipients,
                )

        if refused_recipients:
            rejected = sorted(str(address) for address in refused_recipients)
            logger.warning(
                'SMTP rejected report email recipients message_id=%s sender=%s recipients=%s '
                'rejected=%s subject=%s host=%s port=%s mode=%s',
                message_id,
                settings.smtp_from,
                recipients,
                rejected,
                subject,
                settings.smtp_host,
                settings.smtp_port,
                mode,
            )
            raise EmailDeliveryError(
                'El servidor SMTP rechazó uno o más destinatarios.'
            )

        logger.info(
            'SMTP accepted report email message_id=%s sender=%s recipients=%s '
            'subject=%s host=%s port=%s mode=%s',
            message_id,
            settings.smtp_from,
            recipients,
            subject,
            settings.smtp_host,
            settings.smtp_port,
            mode,
        )
        return message_id
    except smtplib.SMTPAuthenticationError as exc:
        _log_smtp_error(exc, mode, message_id, recipients, subject)
        raise EmailDeliveryError(
            'No fue posible autenticar con el servidor SMTP. '
            'Revisa el usuario, la contraseña y los permisos de la cuenta.'
        ) from exc
    except ssl.SSLError as exc:
        _log_smtp_error(exc, mode, message_id, recipients, subject)
        raise EmailDeliveryError(
            'No fue posible establecer la conexión segura SSL/TLS con el servidor SMTP.'
        ) from exc
    except (socket.timeout, TimeoutError) as exc:
        _log_smtp_error(exc, mode, message_id, recipients, subject)
        raise EmailDeliveryError(
            'El servidor SMTP no respondió dentro del tiempo permitido.'
        ) from exc
    except ConnectionRefusedError as exc:
        _log_smtp_error(exc, mode, message_id, recipients, subject)
        raise EmailDeliveryError(
            'El servidor SMTP rechazó la conexión. Revisa el host, el puerto o el firewall.'
        ) from exc
    except smtplib.SMTPRecipientsRefused as exc:
        rejected = sorted(str(address) for address in exc.recipients)
        logger.warning(
            'SMTP rejected all report email recipients message_id=%s sender=%s '
            'recipients=%s rejected=%s subject=%s host=%s port=%s mode=%s',
            message_id,
            settings.smtp_from,
            recipients,
            rejected,
            subject,
            settings.smtp_host,
            settings.smtp_port,
            mode,
        )
        raise EmailDeliveryError(
            'El servidor SMTP rechazó uno o más destinatarios.'
        ) from exc
    except smtplib.SMTPSenderRefused as exc:
        _log_smtp_error(exc, mode, message_id, recipients, subject)
        raise EmailDeliveryError(
            'El servidor SMTP rechazó la dirección remitente configurada.'
        ) from exc
    except (smtplib.SMTPException, OSError) as exc:
        _log_smtp_error(exc, mode, message_id, recipients, subject)
        raise EmailDeliveryError(
            'No fue posible enviar el correo desde el servidor SMTP.'
        ) from exc


def send_email_with_bytes_attachment(
    to: str | Iterable[str],
    subject: str,
    message: str,
    attachment_bytes: bytes,
    filename: str,
    *,
    cc: str | Iterable[str] | None = None,
    maintype: str = 'application',
    subtype: str = 'pdf',
) -> EmailSendResult:
    recipients = _normalize_recipients(to)
    cc_recipients = _normalize_recipients(cc)
    all_recipients = recipients + cc_recipients
    if not recipients:
        raise EmailDeliveryError('Debes indicar al menos un destinatario valido.')

    email = EmailMessage()
    email['From'] = settings.smtp_from
    email['To'] = ', '.join(recipients)
    if cc_recipients:
        email['Cc'] = ', '.join(cc_recipients)
    email['Subject'] = subject
    email['Date'] = formatdate(localtime=True)
    email['Message-ID'] = make_msgid(domain='rsrc.com.mx')
    email['X-Report-Source'] = 'Dashboard ARCA Las Fuentes'
    email.set_content(message or 'Se adjunta reporte generado desde el dashboard.')
    email.add_attachment(
        attachment_bytes,
        maintype=maintype,
        subtype=subtype,
        filename=filename,
    )

    message_id = _send_message(email, all_recipients)
    return EmailSendResult(
        message='El servidor SMTP aceptó el correo para envío.',
        message_id=message_id,
    )



def send_email_with_bytes_attachments(
    to: str | Iterable[str],
    subject: str,
    message: str,
    attachments: Iterable[dict[str, object]],
    *,
    cc: str | Iterable[str] | None = None,
) -> EmailSendResult:
    recipients = _normalize_recipients(to)
    cc_recipients = _normalize_recipients(cc)
    all_recipients = recipients + cc_recipients
    if not recipients:
        raise EmailDeliveryError('Debes indicar al menos un destinatario valido.')

    normalized_attachments = list(attachments or [])
    if not normalized_attachments:
        raise EmailDeliveryError('Debes adjuntar al menos un formato de reporte.')

    email = EmailMessage()
    email['From'] = settings.smtp_from
    email['To'] = ', '.join(recipients)
    if cc_recipients:
        email['Cc'] = ', '.join(cc_recipients)
    email['Subject'] = subject
    email['Date'] = formatdate(localtime=True)
    email['Message-ID'] = make_msgid(domain='rsrc.com.mx')
    email['X-Report-Source'] = 'Dashboard ARCA Las Fuentes'
    email.set_content(message or 'Se adjunta reporte generado desde el dashboard.')

    for attachment in normalized_attachments:
        email.add_attachment(
            attachment.get('bytes') or b'',
            maintype=str(attachment.get('maintype') or 'application'),
            subtype=str(attachment.get('subtype') or 'octet-stream'),
            filename=str(attachment.get('filename') or 'reporte.bin'),
        )

    message_id = _send_message(email, all_recipients)
    return EmailSendResult(
        message='El servidor SMTP aceptó el correo para envío.',
        message_id=message_id,
    )


def send_email_with_attachment(to: str, subject: str, message: str, attachment: Path) -> str:
    try:
        with attachment.open('rb') as f:
            data = f.read()
        result = send_email_with_bytes_attachment(
            to=to,
            subject=subject,
            message=message,
            attachment_bytes=data,
            filename=attachment.name,
            subtype='octet-stream',
        )
        return result.message
    except EmailNotConfiguredError:
        return 'SMTP no configurado. Se generó el archivo pero no se envió el correo.'
    except EmailDeliveryError as exc:
        return str(exc)
