// ============================================================
// Jenkins init script — runs once on first startup
// Auto-installs required plugins and creates the pipeline job.
// File: jenkins/init.groovy.d/01-setup.groovy
// ============================================================
import jenkins.model.*
import hudson.security.*
import org.jenkinsci.plugins.workflow.job.WorkflowJob
import org.jenkinsci.plugins.workflow.cps.CpsScmFlowDefinition
import hudson.plugins.git.GitSCM
import hudson.plugins.git.BranchSpec
import hudson.plugins.git.UserRemoteConfig

def jenkins = Jenkins.getInstance()

// ── 1. Disable setup wizard (already done via JAVA_OPTS) ─────────────────────
jenkins.setInstallState(InstallState.INITIAL_SETUP_COMPLETED)

// ── 2. Install required plugins ──────────────────────────────────────────────
def pluginManager = jenkins.getPluginManager()
def updateCenter  = jenkins.getUpdateCenter()
updateCenter.updateAllSites()

def requiredPlugins = [
  'git',
  'github',
  'workflow-aggregator',    // Pipeline
  'pipeline-stage-view',
  'docker-workflow',
  'docker-plugin',
  'ssh-agent',
  'credentials-binding',
  'html-publisher',
  'timestamper',
  'ws-cleanup',
  'ansicolor',
  'build-timeout',
  'parameterized-trigger',
]

def installed = false
requiredPlugins.each { pluginName ->
  if (!pluginManager.getPlugin(pluginName)) {
    def plugin = updateCenter.getPlugin(pluginName)
    if (plugin) {
      plugin.deploy(true)
      installed = true
      println "Installed plugin: ${pluginName}"
    } else {
      println "WARNING: Plugin not found in update center: ${pluginName}"
    }
  } else {
    println "Already installed: ${pluginName}"
  }
}

if (installed) {
  jenkins.restart()
}

jenkins.save()
println "Jenkins init complete."
