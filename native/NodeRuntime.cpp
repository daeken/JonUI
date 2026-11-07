#include "jonui.h"
#include <node.h>
#include <node_api.h>
#include <uv.h>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace {
std::thread runtime;
std::mutex gate;
napi_threadsafe_function events = nullptr;
node::Environment* environment = nullptr;
void* host = nullptr;
std::atomic<int> exitStatus{0};
std::thread::id owner;

bool check(napi_env env, napi_status status) {
  if (status == napi_ok) return true;
  const napi_extended_error_info* error = nullptr;
  napi_get_last_error_info(env, &error);
  napi_throw_error(env, nullptr, error && error->error_message ? error->error_message : "Node-API failure");
  return false;
}
std::string stringArg(napi_env env, napi_value value) {
  size_t size = 0;
  if (!check(env, napi_get_value_string_utf8(env, value, nullptr, 0, &size))) return {};
  std::vector<char> bytes(size + 1);
  if (!check(env, napi_get_value_string_utf8(env, value, bytes.data(), bytes.size(), &size))) return {};
  return std::string(bytes.data(), size);
}
void releaseEvents(napi_threadsafe_function_release_mode mode) {
  std::lock_guard<std::mutex> lock(gate);
  if (events) { napi_release_threadsafe_function(events, mode); events = nullptr; }
}
void cleanup(void*) { releaseEvents(napi_tsfn_abort); }
void deliver(napi_env env, napi_value callback, void*, void* payload) {
  std::unique_ptr<std::string> message(static_cast<std::string*>(payload));
  if (!env || !callback) return;
  napi_value value, receiver, result;
  if (!check(env, napi_create_string_utf8(env, message->data(), message->size(), &value))) return;
  napi_get_undefined(env, &receiver);
  napi_status status = napi_call_function(env, receiver, callback, 1, &value, &result);
  if (status == napi_pending_exception) {
    napi_value exception;
    napi_get_and_clear_last_exception(env, &exception);
    napi_fatal_exception(env, exception);
  } else { check(env, status); }
}
napi_value request(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value arg;
  napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
  if (count != 1) { napi_throw_type_error(env, nullptr, "request expects JSON"); return nullptr; }
  std::string json = stringArg(env, arg);
  bool pending; napi_is_exception_pending(env, &pending); if (pending) return nullptr;
  char* response = ju_host_request(host, json.c_str());
  napi_value result;
  auto status = napi_create_string_utf8(env, response, NAPI_AUTO_LENGTH, &result);
  free(response);
  return check(env, status) ? result : nullptr;
}
napi_value listen(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value callback, name;
  napi_get_cb_info(env, info, &count, &callback, nullptr, nullptr);
  napi_valuetype type;
  if (count != 1 || napi_typeof(env, callback, &type) != napi_ok || type != napi_function) {
    napi_throw_type_error(env, nullptr, "listen expects a callback"); return nullptr;
  }
  std::lock_guard<std::mutex> lock(gate);
  if (events) { napi_throw_error(env, nullptr, "Only one event listener is supported"); return nullptr; }
  napi_create_string_utf8(env, "JonUI native events", NAPI_AUTO_LENGTH, &name);
  if (!check(env, napi_create_threadsafe_function(env, callback, nullptr, name, 4096, 1,
      nullptr, nullptr, nullptr, deliver, &events))) return nullptr;
  return nullptr;
}
napi_value finish(napi_env env, napi_callback_info info) {
  size_t count = 1; napi_value arg; int32_t code = 0;
  napi_get_cb_info(env, info, &count, &arg, nullptr, nullptr);
  if (count) napi_get_value_int32(env, arg, &code);
  exitStatus = code;
  releaseEvents(napi_tsfn_release);
  node::Stop(environment);
  return nullptr;
}
napi_value initialize(napi_env env, napi_value exports) {
  if (std::this_thread::get_id() != owner) {
    napi_throw_error(env, nullptr, "JonUI must be imported on the launcher Node thread, not a Worker"); return nullptr;
  }
  napi_property_descriptor methods[] = {
    {"request", nullptr, request, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"listen", nullptr, listen, nullptr, nullptr, nullptr, napi_default, nullptr},
    {"finish", nullptr, finish, nullptr, nullptr, nullptr, napi_default, nullptr},
  };
  napi_define_properties(env, exports, 3, methods);
  napi_add_env_cleanup_hook(env, cleanup, nullptr);
  return exports;
}
int run(std::vector<std::string> args) {
  owner = std::this_thread::get_id();
  auto init = node::InitializeOncePerProcess(args, {
    node::ProcessInitializationFlags::kNoInitializeV8,
    node::ProcessInitializationFlags::kNoInitializeNodeV8Platform,
    node::ProcessInitializationFlags::kDisableNodeOptionsEnv
  });
  for (const auto& error : init->errors()) fprintf(stderr, "jonui: %s\n", error.c_str());
  if (init->early_return()) return init->exit_code();
  auto platform = node::MultiIsolatePlatform::Create(4);
  v8::V8::InitializePlatform(platform.get());
  v8::V8::Initialize();
  int result = 1;
  {
    std::vector<std::string> errors;
    auto setup = node::CommonEnvironmentSetup::Create(platform.get(), &errors, init->args(), init->exec_args());
    if (setup) {
      auto isolate = setup->isolate();
      v8::Locker locker(isolate);
      v8::Isolate::Scope isolateScope(isolate);
      v8::HandleScope handles(isolate);
      v8::Context::Scope context(setup->context());
      {
        std::lock_guard<std::mutex> lock(gate);
        environment = setup->env();
      }
      node::SetProcessExitHandler(environment, [](node::Environment* env, int code) {
        exitStatus = code; node::Stop(env);
      });
      node::AddLinkedBinding(environment, "jonui", initialize);
      if (!node::LoadEnvironment(environment, node::StartExecutionCallback{}).IsEmpty()) {
        result = node::SpinEventLoop(environment).FromMaybe(exitStatus.load());
      }
      node::Stop(environment);
      releaseEvents(napi_tsfn_abort);
      { std::lock_guard<std::mutex> lock(gate); environment = nullptr; }
    } else {
      for (const auto& error : errors) fprintf(stderr, "jonui: %s\n", error.c_str());
    }
  }
  v8::V8::Dispose();
  v8::V8::DisposePlatform();
  node::TearDownOncePerProcess();
  return exitStatus ? exitStatus.load() : result;
}
}
extern "C" void ju_runtime_start(void* swiftHost, const char* executable, const char* bootstrap, const char* entry) {
  host = swiftHost;
  std::vector<std::string> args{executable, "--disable-warning=ExperimentalWarning", bootstrap, entry};
  runtime = std::thread([args] {
    int result = run(args);
    ju_host_runtime_stopped(host, result);
  });
}
extern "C" void ju_runtime_join() { if (runtime.joinable()) runtime.join(); }
extern "C" int32_t ju_runtime_emit(const char* json) {
  auto message = std::make_unique<std::string>(json);
  std::lock_guard<std::mutex> lock(gate);
  if (!events) return 0;
  auto status = napi_call_threadsafe_function(events, message.get(), napi_tsfn_nonblocking);
  if (status == napi_ok) { message.release(); return 1; }
  if (status == napi_closing) return 0;
  fprintf(stderr, "jonui: native event queue overflow/failure (%d)\n", status);
  exitStatus = 1;
  if (environment) node::Stop(environment);
  return -1;
}
extern "C" void ju_runtime_abort(const char* message) {
  fprintf(stderr, "jonui: %s\n", message);
  exitStatus = 1;
  std::lock_guard<std::mutex> lock(gate);
  if (environment) node::Stop(environment);
}
