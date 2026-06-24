pipeline {
    agent any

    parameters {
        choice(
            name: 'TEST_SUITE',
            choices: ['web:login', 'api:login', 'web:smoke', 'api:smoke', 'web', 'api', 'test'],
            description: 'Select test suite to execute'
        )
        choice(
            name: 'ENVIRONMENT',
            choices: ['qa', 'staging', 'dev'],
            description: 'Target environment'
        )
    }

    environment {
        ENV = "${params.ENVIRONMENT}"
        ENABLE_TESTRAIL = 'false'
        HEADLESS = 'true'
    }

    stages {
        stage('Checkout') {
            steps {
                checkout scm
            }
        }

        stage('Setup') {
            steps {
                sh 'npm ci'
                sh 'npx playwright install --with-deps chromium'
                sh 'cp .env.example .env'
            }
        }

        stage('Run Tests') {
            steps {
                withCredentials([
                    string(credentialsId: 'BASE_URL', variable: 'BASE_URL'),
                    string(credentialsId: 'API_BASE_URL', variable: 'API_BASE_URL'),
                    usernamePassword(credentialsId: 'TEST_CREDENTIALS', usernameVariable: 'VALID_USER_EMAIL', passwordVariable: 'VALID_USER_PASSWORD')
                ]) {
                    sh "npm run ${params.TEST_SUITE}"
                }
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'reports/**/*', allowEmptyArchive: true
            archiveArtifacts artifacts: 'test-results/**/*', allowEmptyArchive: true
            archiveArtifacts artifacts: 'logs/**/*', allowEmptyArchive: true
            junit 'test-results/**/*.xml'
        }
    }
}
