# V105 Explicit data classification and sink policy

V105 adds versioned tenant handling policies for PUBLIC, INTERNAL, CONFIDENTIAL and RESTRICTED fields. Every field must be explicitly classified before projection to an application/log/notification/export/AI sink. Missing rules deny by default, and RESTRICTED values can never be configured to pass raw to logs or notifications. No firm-specific data taxonomy is inferred.
