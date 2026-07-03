# Source from other scripts:  source "$(dirname "$0")/resolve-java.sh"
resolve_java_home() {
  if [ -n "${JAVA_HOME:-}" ] && [ -x "${JAVA_HOME}/bin/java" ]; then
    export PATH="$JAVA_HOME/bin:$PATH"
    return 0
  fi
  if [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
  elif [ -d "/Applications/Android Studio.app/Contents/jbr" ]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr"
  elif command -v brew >/dev/null 2>&1; then
    local brew_jdk
    brew_jdk="$(brew --prefix openjdk@17 2>/dev/null)/libexec/openjdk.jdk/Contents/Home"
    if [ -x "$brew_jdk/bin/java" ]; then
      export JAVA_HOME="$brew_jdk"
    fi
  fi
  if [ -z "${JAVA_HOME:-}" ] && /usr/libexec/java_home -v 17 >/dev/null 2>&1; then
    export JAVA_HOME="$(/usr/libexec/java_home -v 17)"
  elif [ -z "${JAVA_HOME:-}" ] && /usr/libexec/java_home >/dev/null 2>&1; then
    export JAVA_HOME="$(/usr/libexec/java_home)"
  fi
  if [ -n "${JAVA_HOME:-}" ] && [ -x "$JAVA_HOME/bin/java" ]; then
    export PATH="$JAVA_HOME/bin:$PATH"
    return 0
  fi
  echo "No Java found. Run: brew install openjdk@17"
  echo "Then: source ~/.zshrc  OR  npm run build:local:android"
  return 1
}
