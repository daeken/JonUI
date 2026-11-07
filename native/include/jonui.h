#pragma once
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
// The host is a retained Swift object. Requests return malloc-owned UTF-8 JSON.
char* ju_host_request(void* host, const char* json);
void ju_host_runtime_stopped(void* host, int32_t status);
int32_t ju_runtime_emit(const char* json);
void ju_runtime_abort(const char* message);
void ju_runtime_start(void* host, const char* executable, const char* bootstrap, const char* entry);
void ju_runtime_join(void);
#ifdef __cplusplus
}
#endif
